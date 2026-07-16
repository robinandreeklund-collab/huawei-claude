// Explicit model classes. ArkTS is strict — no structural object literals where a
// class is expected, no `any`. These mirror the Wear OS client's data classes.

/** Route keys, stored in AppStorage under 'route'. */
export class Routes {
  static readonly SPLASH: string = 'splash';
  static readonly PAIRING: string = 'pairing';
  static readonly CONNECT: string = 'connect';
  static readonly CONSENT: string = 'consent';
  static readonly HOME: string = 'home';
  static readonly LIST: string = 'list';
  static readonly CHAT: string = 'chat';
  static readonly SETTINGS: string = 'settings';
}

/** Chat bubble roles. */
export class Roles {
  static readonly ME: string = 'me';
  static readonly AI: string = 'ai';
  static readonly TOOL: string = 'tool';
}

let msgCounter: number = 0;

/** A single chat bubble. `key` gives every bubble a stable identity so the
 *  streaming bubble can be found and reconciled without ambiguity. */
export class ChatMsg {
  role: string;
  text: string;
  streaming: boolean;
  filtered: boolean;
  report: boolean;
  key: number;

  constructor(role: string, text: string) {
    this.role = role;
    this.text = text;
    this.streaming = false;
    this.filtered = false;
    this.report = false;
    msgCounter += 1;
    this.key = msgCounter;
  }
}

/** An entry in a List screen (chats / projects / code). */
export class ListItem {
  id: string;
  title: string;
  subtitle: string;

  constructor(id: string, title: string, subtitle: string) {
    this.id = id;
    this.title = title;
    this.subtitle = subtitle;
  }
}

/** One of the three Claude surfaces shown on Home. */
export class Scope {
  key: string;
  title: string;
  subtitle: string;

  constructor(key: string, title: string, subtitle: string) {
    this.key = key;
    this.title = title;
    this.subtitle = subtitle;
  }

  static readonly CHATS: Scope = new Scope('chats', 'Chats', 'your conversations');
  static readonly PROJECTS: Scope = new Scope('projects', 'Projects', 'your projects');
  static readonly CODE: Scope = new Scope('code', 'Claude Code', 'code sessions');

  static all(): Scope[] {
    return [Scope.CHATS, Scope.PROJECTS, Scope.CODE];
  }

  static byKey(key: string): Scope {
    if (key === 'projects') {
      return Scope.PROJECTS;
    }
    if (key === 'code') {
      return Scope.CODE;
    }
    return Scope.CHATS;
  }
}

/** Language options on the Settings screen: label -> backend code. */
export class LangOption {
  code: string;
  label: string;

  constructor(code: string, label: string) {
    this.code = code;
    this.label = label;
  }

  static all(): LangOption[] {
    return [
      new LangOption('', 'Auto'),
      new LangOption('svenska', 'SV'),
      new LangOption('english', 'EN')
    ];
  }
}
