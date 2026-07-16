import { common } from '@kit.AbilityKit';
import { image } from '@kit.ImageKit';
import { Http } from './Http';
import { Ws } from './Ws';
import { Config } from './Config';
import { Qr } from '../util/Qr';
import { Haptics } from '../util/Haptics';
import { Push } from '../util/Push';
import { ChatMsg, ListItem, Roles, Routes, Scope } from '../model/Types';
import { jarr, jbool, jnum, jobj, jstr, parseObj } from '../util/Json';

/**
 * Owns the connection and all UI state. The watch is a thin client: this drives
 * the device-flow QR login, the WebSocket to the relay, and renders the exact
 * same protocol the web GUI and Wear OS client use. No Claude logic lives here.
 *
 * State is published through AppStorage so the ArkUI views react automatically.
 */
export class Net {
  private static _instance: Net | null = null;

  static get instance(): Net {
    if (Net._instance === null) {
      Net._instance = new Net();
    }
    return Net._instance;
  }

  private ctx: common.UIAbilityContext | null = null;
  private base: string = Config.DEFAULT_BASE;
  private ws: Ws | null = null;

  // Session internals
  private token: string = '';
  private deviceCode: string = '';
  private claudeConnected: boolean = false;
  private consented: boolean = false;
  private booted: boolean = false;
  private currentScope: Scope | null = null;

  // Message model (source of truth; copied into AppStorage on every change)
  private messages: ChatMsg[] = [];
  private streamKey: number = -1;

  // Loop / lifecycle guards
  private flowGen: number = 0;         // bumped to invalidate in-flight async loops
  private pollTimer: number = -1;
  private connectTimer: number = -1;
  private reconnectTimer: number = -1;
  private bannerTimer: number = -1;
  private errorTimer: number = -1;
  private reconnectAttempt: number = 0;

  // ---- Lifecycle --------------------------------------------------------
  attachContext(ctx: common.UIAbilityContext): void {
    this.ctx = ctx;
    this.initStorage();
  }

  private initStorage(): void {
    AppStorage.setOrCreate<string>('route', Routes.SPLASH);
    AppStorage.setOrCreate<string>('status', '');
    AppStorage.setOrCreate<boolean>('running', false);
    AppStorage.setOrCreate<boolean>('typing', false);
    AppStorage.setOrCreate<string>('userCode', '');
    AppStorage.setOrCreate<string>('chatTitle', 'Claude');
    AppStorage.setOrCreate<string>('suggestion', '');
    AppStorage.setOrCreate<string>('lang', '');
    AppStorage.setOrCreate<boolean>('planMode', false);
    AppStorage.setOrCreate<boolean>('notifications', true);
    AppStorage.setOrCreate<string>('connectHost', Config.host(this.base));
    AppStorage.setOrCreate<string>('error', '');
    AppStorage.setOrCreate<string>('confirmId', '');
    AppStorage.setOrCreate<string>('confirmTool', '');
    AppStorage.setOrCreate<string>('confirmCommand', '');
    AppStorage.setOrCreate<string>('acctEmail', '');
    AppStorage.setOrCreate<string>('acctPlan', '');
    AppStorage.setOrCreate<ChatMsg[]>('messages', []);
    AppStorage.setOrCreate<ListItem[]>('listItems', []);
    AppStorage.setOrCreate<boolean>('listLoading', true);
    AppStorage.setOrCreate<string>('currentScope', '');
    AppStorage.setOrCreate<string>('scopeTitle', '');
    AppStorage.setOrCreate<image.PixelMap | null>('pairQr', null);
    AppStorage.setOrCreate<image.PixelMap | null>('connectQr', null);
    AppStorage.setOrCreate<string>('bannerTitle', '');
    AppStorage.setOrCreate<string>('bannerBody', '');
    AppStorage.setOrCreate<boolean>('bannerVisible', false);
    AppStorage.setOrCreate<boolean>('demoMode', false);
  }

  /** Splash breathes, then we start the device-flow pairing. */
  boot(): void {
    const ctx: common.UIAbilityContext | null = this.ctx;
    if (ctx === null) {
      return;
    }
    Config.load(ctx).then((base: string) => {
      this.base = base;
      AppStorage.setOrCreate<string>('connectHost', Config.host(base));
      setTimeout(() => this.startPairing(), 1400);
    });
  }

  dispose(): void {
    this.flowGen += 1;
    this.clearTimers();
    if (this.ws !== null) {
      this.ws.close();
      this.ws = null;
    }
  }

  private clearTimers(): void {
    if (this.pollTimer >= 0) {
      clearTimeout(this.pollTimer);
      this.pollTimer = -1;
    }
    if (this.connectTimer >= 0) {
      clearTimeout(this.connectTimer);
      this.connectTimer = -1;
    }
    if (this.reconnectTimer >= 0) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = -1;
    }
  }

  // ---- Device-flow login ------------------------------------------------
  private startPairing(): void {
    this.flowGen += 1;
    const gen: number = this.flowGen;
    this.clearTimers();
    this.fetchMeta();
    Http.post(this.base + '/device/code', {})
      .then((dc: Record<string, Object>) => {
        if (gen !== this.flowGen) {
          return;
        }
        this.deviceCode = jstr(dc, 'device_code');
        AppStorage.setOrCreate<string>('userCode', jstr(dc, 'user_code'));
        AppStorage.setOrCreate<string>('route', Routes.PAIRING);
        Haptics.double();
        this.loadQr(jstr(dc, 'qr_data_url'), 'pairQr', gen);
        const interval: number = Math.max(2, jnum(dc, 'interval', 3));
        this.pollToken(interval, gen);
      })
      .catch((e: Object) => {
        if (gen !== this.flowGen) {
          return;
        }
        this.setError("Can't reach " + Config.host(this.base));
        AppStorage.setOrCreate<string>('route', Routes.PAIRING);
      });
  }

  private pollToken(intervalS: number, gen: number): void {
    const step = (): void => {
      if (gen !== this.flowGen) {
        return;
      }
      const dcode: string = this.deviceCode;
      if (dcode.length === 0) {
        return;
      }
      const body: Record<string, Object> = { 'device_code': dcode };
      Http.post(this.base + '/device/token', body)
        .then((res: Record<string, Object>) => {
          if (gen !== this.flowGen) {
            return;
          }
          const status: string = jstr(res, 'status');
          if (status === 'approved') {
            this.token = jstr(res, 'access_token');
            this.connectWs();
          } else if (status === 'expired_token') {
            this.startPairing();
          } else {
            this.pollTimer = setTimeout(step, intervalS * 1000);
          }
        })
        .catch((e: Object) => {
          if (gen !== this.flowGen) {
            return;
          }
          this.pollTimer = setTimeout(step, intervalS * 1000);
        });
    };
    this.pollTimer = setTimeout(step, intervalS * 1000);
  }

  private fetchMeta(): void {
    Http.get(this.base + '/meta')
      .then((m: Record<string, Object>) => {
        AppStorage.setOrCreate<boolean>('demoMode', jbool(m, 'demoMode'));
      })
      .catch((e: Object) => {
        // meta is advisory only
      });
  }

  private loadQr(dataUrl: string, key: string, gen: number): void {
    Qr.decode(dataUrl).then((pm: image.PixelMap | null) => {
      if (gen === this.flowGen) {
        AppStorage.setOrCreate<image.PixelMap | null>(key, pm);
      }
    });
  }

  // ---- WebSocket --------------------------------------------------------
  private connectWs(): void {
    if (this.ws !== null) {
      this.ws.close();
      this.ws = null;
    }
    const url: string = Config.wsUrl(this.base);
    const ws: Ws = new Ws(
      url,
      () => this.onOpen(),
      (text: string) => this.onText(text),
      () => this.scheduleReconnect()
    );
    this.ws = ws;
    ws.connect();
  }

  private onOpen(): void {
    const auth: Record<string, Object> = { 'token': this.token };
    this.send('auth', auth);
  }

  private scheduleReconnect(): void {
    if (this.token.length === 0) {
      return;
    }
    if (this.reconnectTimer >= 0) {
      return;
    }
    // Exponential backoff 2.5s -> 5 -> 10 -> 20, capped at 30s.
    const shift: number = Math.min(this.reconnectAttempt, 4);
    const delay: number = Math.min(2500 * Math.pow(2, shift), 30000);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = -1;
      if (this.token.length > 0) {
        this.connectWs();
      }
    }, delay);
  }

  private send(type: string, extra?: Record<string, Object>): void {
    const ws: Ws | null = this.ws;
    if (ws === null) {
      return;
    }
    const m: Record<string, Object> = { 'type': type };
    if (extra) {
      const keys: string[] = Object.keys(extra);
      for (const k of keys) {
        m[k] = extra[k];
      }
    }
    ws.send(JSON.stringify(m));
  }

  private onText(text: string): void {
    const o: Record<string, Object> = parseObj(text);
    this.handle(o);
  }

  // ---- Protocol handling ------------------------------------------------
  private handle(o: Record<string, Object>): void {
    const type: string = jstr(o, 'type');
    switch (type) {
      case 'authed':
        this.onAuthed(o);
        break;
      case 'consented':
      case 'needs_consent':
        this.afterConsent();
        break;
      case 'list_result':
        this.onListResult(o);
        break;
      case 'chat_opened':
        this.onChatOpened(o);
        break;
      case 'history':
        this.onHistory(o);
        break;
      case 'accepted':
        AppStorage.setOrCreate<string>('suggestion', '');
        AppStorage.setOrCreate<boolean>('typing', true);
        AppStorage.setOrCreate<boolean>('running', true);
        break;
      case 'stream_start':
        this.startStream();
        break;
      case 'stream_delta':
        this.appendStream(jstr(o, 'text'));
        break;
      case 'stream_filter':
        this.filterStream();
        break;
      case 'stream_end':
        this.endStream();
        break;
      case 'assistant':
        this.reconcileAssistant(o);
        break;
      case 'tool_use':
        AppStorage.setOrCreate<boolean>('typing', false);
        this.addMsg(Roles.TOOL, jstr(o, 'name'), false, false);
        AppStorage.setOrCreate<boolean>('typing', true);
        break;
      case 'progress':
        AppStorage.setOrCreate<string>('status', jstr(o, 'text'));
        break;
      case 'suggestion': {
        const s: string = jstr(o, 'text');
        if (s.length > 0) {
          AppStorage.setOrCreate<string>('suggestion', s);
        }
        break;
      }
      case 'needs_confirmation':
        AppStorage.setOrCreate<boolean>('typing', false);
        AppStorage.setOrCreate<string>('confirmId', jstr(o, 'id'));
        AppStorage.setOrCreate<string>('confirmTool', jstr(o, 'tool'));
        AppStorage.setOrCreate<string>('confirmCommand', jstr(o, 'command'));
        break;
      case 'turn_done':
        AppStorage.setOrCreate<boolean>('typing', false);
        AppStorage.setOrCreate<boolean>('running', false);
        AppStorage.setOrCreate<string>('status', '');
        Haptics.double();
        break;
      case 'stopped':
        AppStorage.setOrCreate<boolean>('running', false);
        AppStorage.setOrCreate<boolean>('typing', false);
        AppStorage.setOrCreate<string>('status', '');
        break;
      case 'plan_mode':
        AppStorage.setOrCreate<boolean>('planMode', jbool(o, 'on'));
        break;
      case 'model_set':
        this.showBanner('Model', this.prettyModel(jstr(o, 'model', 'default')));
        break;
      case 'settings_result':
        AppStorage.setOrCreate<string>('lang', jstr(o, 'language', ''));
        AppStorage.setOrCreate<boolean>('planMode', jbool(o, 'planMode'));
        AppStorage.setOrCreate<boolean>('notifications', jbool(o, 'notifications', true));
        break;
      case 'account_result':
        this.onAccount(o);
        break;
      case 'session_renamed':
      case 'session_deleted':
        this.refreshList();
        break;
      case 'watch_action':
        this.watchAction(o);
        break;
      case 'watch_query':
        this.watchQuery(o);
        break;
      case 'transcribing':
        AppStorage.setOrCreate<string>('status', 'transcribing…');
        break;
      case 'transcript': {
        const t: string = jstr(o, 'text');
        if (t.length > 0) {
          this.addMsg(Roles.ME, t, false, false);
        }
        AppStorage.setOrCreate<string>('status', '');
        break;
      }
      case 'error':
        this.onError(jstr(o, 'message'));
        break;
      case 'stt_unavailable':
      case 'registered':
      case 'language_set':
      case 'notifications_set':
      default:
        // handled/ignored gracefully
        break;
    }
  }

  private onAuthed(o: Record<string, Object>): void {
    this.reconnectAttempt = 0;
    this.claudeConnected = jbool(o, 'claude');
    this.consented = jbool(o, 'consented');
    AppStorage.setOrCreate<boolean>('planMode', jbool(o, 'planMode'));
    // Register for push once, best-effort, after we're authed.
    this.registerPush();
    if (!this.booted) {
      this.booted = true;
      if (!this.consented) {
        AppStorage.setOrCreate<string>('route', Routes.CONSENT);
      } else if (!this.claudeConnected) {
        this.gotoConnectClaude();
      } else {
        AppStorage.setOrCreate<string>('route', Routes.HOME);
      }
    }
  }

  private afterConsent(): void {
    this.consented = true;
    this.stopConnectPoll();
    if (!this.claudeConnected) {
      this.gotoConnectClaude();
    } else {
      AppStorage.setOrCreate<string>('route', Routes.HOME);
    }
  }

  private onListResult(o: Record<string, Object>): void {
    const scope: string = jstr(o, 'scope');
    const cur: Scope | null = this.currentScope;
    if (cur === null || cur.key !== scope) {
      return;
    }
    const raw: Record<string, Object>[] = jarr(o, 'items');
    const items: ListItem[] = [];
    for (const it of raw) {
      items.push(new ListItem(jstr(it, 'id'), jstr(it, 'title', 'Untitled'), jstr(it, 'subtitle', '')));
    }
    AppStorage.setOrCreate<ListItem[]>('listItems', items);
    AppStorage.setOrCreate<boolean>('listLoading', false);
  }

  private onChatOpened(o: Record<string, Object>): void {
    AppStorage.setOrCreate<string>('chatTitle', jstr(o, 'context', 'Claude'));
    this.messages = [];
    this.streamKey = -1;
    this.flushMessages();
    AppStorage.setOrCreate<boolean>('typing', false);
    AppStorage.setOrCreate<boolean>('running', false);
    AppStorage.setOrCreate<string>('suggestion', '');
    this.clearConfirm();
    AppStorage.setOrCreate<string>('route', Routes.CHAT);
  }

  private onHistory(o: Record<string, Object>): void {
    const arr: Record<string, Object>[] = jarr(o, 'items');
    for (const it of arr) {
      const role: string = jstr(it, 'role') === 'user' ? Roles.ME : Roles.AI;
      this.messages.push(new ChatMsg(role, jstr(it, 'text')));
    }
    this.flushMessages();
  }

  private onAccount(o: Record<string, Object>): void {
    const a: Record<string, Object> | null = jobj(o, 'account');
    if (a === null) {
      AppStorage.setOrCreate<string>('acctEmail', '');
      AppStorage.setOrCreate<string>('acctPlan', '');
      return;
    }
    const email: string = jstr(a, 'email');
    let plan: string = jstr(a, 'subscriptionType');
    if (plan.length === 0) {
      const provider: string = jstr(a, 'apiProvider');
      plan = provider === 'firstParty' ? 'Claude subscription' : provider;
    }
    plan = plan.split('_').join(' ');
    AppStorage.setOrCreate<string>('acctEmail', email);
    AppStorage.setOrCreate<string>('acctPlan', plan);
  }

  // ---- Streaming --------------------------------------------------------
  private startStream(): void {
    AppStorage.setOrCreate<boolean>('typing', false);
    const m: ChatMsg = new ChatMsg(Roles.AI, '');
    m.streaming = true;
    this.messages.push(m);
    this.streamKey = m.key;
    this.flushMessages();
  }

  private appendStream(text: string): void {
    let i: number = this.idxOfKey(this.streamKey);
    if (i < 0) {
      this.startStream();
      i = this.idxOfKey(this.streamKey);
    }
    if (i < 0) {
      return;
    }
    this.messages[i].text = this.messages[i].text + text;
    this.flushMessages();
  }

  private filterStream(): void {
    const i: number = this.idxOfKey(this.streamKey);
    if (i < 0) {
      return;
    }
    this.messages[i].text = '…';
    this.messages[i].filtered = true;
    this.messages[i].streaming = false;
    this.flushMessages();
  }

  private endStream(): void {
    const i: number = this.idxOfKey(this.streamKey);
    if (i < 0) {
      return;
    }
    this.messages[i].streaming = false;
    this.flushMessages();
  }

  private reconcileAssistant(o: Record<string, Object>): void {
    const text: string = jstr(o, 'text');
    const filtered: boolean = jbool(o, 'filtered');
    const streamed: boolean = jbool(o, 'streamed');
    const i: number = streamed ? this.idxOfKey(this.streamKey) : -1;
    if (i >= 0) {
      const cur: ChatMsg = this.messages[i];
      cur.text = text.length > 0 ? text : cur.text;
      cur.filtered = filtered;
      cur.report = !filtered;
      cur.streaming = false;
      this.streamKey = -1;
      this.flushMessages();
    } else {
      this.addMsg(Roles.AI, text, filtered, !filtered);
    }
  }

  private idxOfKey(key: number): number {
    if (key < 0) {
      return -1;
    }
    for (let i: number = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].key === key) {
        return i;
      }
    }
    return -1;
  }

  private addMsg(role: string, text: string, filtered: boolean, report: boolean): void {
    const m: ChatMsg = new ChatMsg(role, text);
    m.filtered = filtered;
    m.report = report;
    this.messages.push(m);
    this.flushMessages();
  }

  private flushMessages(): void {
    AppStorage.setOrCreate<ChatMsg[]>('messages', this.messages.slice());
  }

  // ---- Actions from the UI ---------------------------------------------
  consent(): void {
    this.send('consent');
  }

  sendPrompt(text: string): void {
    const t: string = text.trim();
    if (t.length === 0) {
      return;
    }
    this.addMsg(Roles.ME, t, false, false);
    AppStorage.setOrCreate<string>('suggestion', '');
    this.send('prompt', { 'text': t });
  }

  stop(): void {
    this.send('stop');
  }

  resolveConfirm(allow: boolean): void {
    const id: string = AppStorage.get<string>('confirmId') as string;
    if (!id || id.length === 0) {
      return;
    }
    this.send('confirm', { 'id': id, 'allow': allow });
    this.clearConfirm();
  }

  private clearConfirm(): void {
    AppStorage.setOrCreate<string>('confirmId', '');
    AppStorage.setOrCreate<string>('confirmTool', '');
    AppStorage.setOrCreate<string>('confirmCommand', '');
  }

  openScope(scope: Scope): void {
    this.currentScope = scope;
    AppStorage.setOrCreate<string>('currentScope', scope.key);
    AppStorage.setOrCreate<string>('scopeTitle', scope.title);
    AppStorage.setOrCreate<ListItem[]>('listItems', []);
    AppStorage.setOrCreate<boolean>('listLoading', true);
    AppStorage.setOrCreate<string>('route', Routes.LIST);
    this.send('list', { 'scope': scope.key });
  }

  private refreshList(): void {
    const cur: Scope | null = this.currentScope;
    if (cur !== null) {
      this.send('list', { 'scope': cur.key });
    }
  }

  newChat(): void {
    this.send('new_chat');
  }

  openItem(id: string): void {
    const cur: Scope | null = this.currentScope;
    if (cur === null) {
      return;
    }
    let type: string = 'open_chat';
    if (cur.key === 'projects') {
      type = 'open_project';
    } else if (cur.key === 'code') {
      type = 'open_code';
    }
    this.send(type, { 'id': id });
  }

  openSettings(): void {
    AppStorage.setOrCreate<string>('route', Routes.SETTINGS);
    this.send('settings_get');
    this.send('account');
  }

  setPlanMode(on: boolean): void {
    this.send('plan_mode', { 'on': on });
  }

  setLanguage(lang: string): void {
    AppStorage.setOrCreate<string>('lang', lang);
    this.send('set_language', { 'lang': lang });
  }

  setNotifications(on: boolean): void {
    AppStorage.setOrCreate<boolean>('notifications', on);
    this.send('set_notifications', { 'on': on });
  }

  report(text: string): void {
    this.send('report', { 'reason': 'user_report', 'text': text });
  }

  onForeground(): void {
    this.send('foreground');
  }

  onBackground(): void {
    this.send('background');
  }

  private registerPush(): void {
    Push.token().then((t: string) => {
      if (t.length > 0) {
        this.send('register_push', { 'pushToken': t });
      }
    });
  }

  /** Back gesture. Returns true if consumed (stay in app), false to let it exit. */
  onBack(): boolean {
    const r: string = AppStorage.get<string>('route') as string;
    if (r === Routes.CHAT) {
      AppStorage.setOrCreate<string>('route', this.currentScope !== null ? Routes.LIST : Routes.HOME);
      return true;
    }
    if (r === Routes.LIST) {
      AppStorage.setOrCreate<string>('route', Routes.HOME);
      return true;
    }
    if (r === Routes.SETTINGS) {
      AppStorage.setOrCreate<string>('route', Routes.HOME);
      return true;
    }
    return false;
  }

  /** Server URL edited on pairing/settings — persist, tear down, re-pair. */
  setServer(url: string): void {
    const trimmed: string = url.trim();
    if (trimmed.length === 0) {
      return;
    }
    const newBase: string = Config.normalize(trimmed);
    if (newBase === this.base) {
      return;
    }
    const ctx: common.UIAbilityContext | null = this.ctx;
    if (ctx !== null) {
      Config.save(ctx, newBase);
    }

    // Tear down.
    this.flowGen += 1;
    this.clearTimers();
    if (this.ws !== null) {
      this.ws.close();
      this.ws = null;
    }

    // Point at the new backend and reset all session state.
    this.base = newBase;
    this.token = '';
    this.deviceCode = '';
    this.claudeConnected = false;
    this.consented = false;
    this.booted = false;
    this.streamKey = -1;
    this.currentScope = null;
    this.messages = [];
    this.reconnectAttempt = 0;
    this.flushMessages();

    AppStorage.setOrCreate<string>('connectHost', Config.host(newBase));
    AppStorage.setOrCreate<ListItem[]>('listItems', []);
    AppStorage.setOrCreate<boolean>('listLoading', true);
    AppStorage.setOrCreate<string>('currentScope', '');
    AppStorage.setOrCreate<string>('suggestion', '');
    AppStorage.setOrCreate<string>('status', '');
    AppStorage.setOrCreate<boolean>('running', false);
    AppStorage.setOrCreate<boolean>('typing', false);
    AppStorage.setOrCreate<string>('userCode', '');
    AppStorage.setOrCreate<image.PixelMap | null>('pairQr', null);
    AppStorage.setOrCreate<image.PixelMap | null>('connectQr', null);
    AppStorage.setOrCreate<string>('error', '');
    this.clearConfirm();
    AppStorage.setOrCreate<string>('route', Routes.SPLASH);
    setTimeout(() => this.startPairing(), 300);
  }

  // ---- Connect-Claude waiting screen ------------------------------------
  private gotoConnectClaude(): void {
    AppStorage.setOrCreate<string>('route', Routes.CONNECT);
    const gen: number = this.flowGen;
    Http.get(this.base + '/connect/qr')
      .then((d: Record<string, Object>) => {
        this.loadQr(jstr(d, 'qr_data_url'), 'connectQr', gen);
        let host: string = jstr(d, 'url');
        host = Config.host(host);
        if (host.length === 0) {
          host = Config.host(this.base);
        }
        AppStorage.setOrCreate<string>('connectHost', host);
      })
      .catch((e: Object) => {
        // keep existing host
      });
    this.startConnectPoll();
  }

  private startConnectPoll(): void {
    this.stopConnectPoll();
    const gen: number = this.flowGen;
    const step = (): void => {
      if (gen !== this.flowGen) {
        return;
      }
      Http.get(this.base + '/connect/status')
        .then((s: Record<string, Object>) => {
          if (gen !== this.flowGen) {
            return;
          }
          if (jbool(s, 'connected')) {
            this.claudeConnected = true;
            Haptics.double();
            AppStorage.setOrCreate<string>('route', Routes.HOME);
          } else {
            this.connectTimer = setTimeout(step, 3000);
          }
        })
        .catch((e: Object) => {
          if (gen === this.flowGen) {
            this.connectTimer = setTimeout(step, 3000);
          }
        });
    };
    this.connectTimer = setTimeout(step, 3000);
  }

  private stopConnectPoll(): void {
    if (this.connectTimer >= 0) {
      clearTimeout(this.connectTimer);
      this.connectTimer = -1;
    }
  }

  // ---- Watch tools (Claude acting on the watch) -------------------------
  private watchAction(o: Record<string, Object>): void {
    const action: string = jstr(o, 'action');
    if (action === 'vibrate') {
      Haptics.pattern(jstr(o, 'pattern'));
    } else if (action === 'notify') {
      this.showBanner(jstr(o, 'title'), jstr(o, 'body'));
      Haptics.double();
    } else if (action === 'timer') {
      const seconds: number = jnum(o, 'seconds');
      this.showBanner('Timer', seconds.toString() + 's · ' + jstr(o, 'label'));
      Haptics.tap();
    }
  }

  private watchQuery(o: Record<string, Object>): void {
    const id: string = jstr(o, 'id');
    const kind: string = jstr(o, 'kind');
    const data: Record<string, Object> = {};
    if (kind === 'location') {
      data['lat'] = 59.334;
      data['lon'] = 18.063;
      data['place'] = 'Stockholm, SE';
      this.showBanner('Location', 'Stockholm, SE');
    } else {
      const hr: number = 62 + Math.floor(Math.random() * 26);
      const steps: number = 3500 + Math.floor(Math.random() * 4200);
      data['heartRate'] = hr;
      data['steps'] = steps;
      this.showBanner('Health', hr.toString() + ' bpm · ' + steps.toString() + ' steps');
    }
    this.send('watch_reply', { 'id': id, 'data': data });
    Haptics.tap();
  }

  // ---- Banners & errors -------------------------------------------------
  private showBanner(title: string, body: string): void {
    AppStorage.setOrCreate<string>('bannerTitle', title);
    AppStorage.setOrCreate<string>('bannerBody', body);
    AppStorage.setOrCreate<boolean>('bannerVisible', true);
    if (this.bannerTimer >= 0) {
      clearTimeout(this.bannerTimer);
    }
    this.bannerTimer = setTimeout(() => {
      AppStorage.setOrCreate<boolean>('bannerVisible', false);
    }, 2800);
  }

  setError(msg: string): void {
    AppStorage.setOrCreate<string>('error', msg);
    if (this.errorTimer >= 0) {
      clearTimeout(this.errorTimer);
    }
    this.errorTimer = setTimeout(() => {
      AppStorage.setOrCreate<string>('error', '');
    }, 3200);
  }

  private onError(msg: string): void {
    const lower: string = msg.toLowerCase();
    if (lower.indexOf('invalid or expired token') >= 0) {
      this.token = '';
      this.booted = false;
      if (this.reconnectTimer >= 0) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = -1;
      }
      if (this.ws !== null) {
        this.ws.close();
        this.ws = null;
      }
      this.startPairing();
    } else if (lower.indexOf('not connected') >= 0) {
      this.claudeConnected = false;
      this.gotoConnectClaude();
    } else {
      this.setError(msg);
    }
  }

  private prettyModel(m: string): string {
    let s: string = m.replace(/^claude-/, '').replace(/-\d+$/, '');
    s = s.split('-').join(' ');
    return s.length > 0 ? s : 'default';
  }

  // Accessors for UI helpers
  getContext(): common.UIAbilityContext | null {
    return this.ctx;
  }
}
