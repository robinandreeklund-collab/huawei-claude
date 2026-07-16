import { common } from '@kit.AbilityKit';
import { promptAction } from '@kit.ArkUI';
import { C } from '../model/Theme';
import { Routes } from '../model/Types';
import { Net } from '../net/Net';
import { Speech } from '../util/Speech';
import { SplashView } from '../components/SplashView';
import { PairingView } from '../components/PairingView';
import { ConnectView } from '../components/ConnectView';
import { ConsentView } from '../components/ConsentView';
import { HomeView } from '../components/HomeView';
import { ListView } from '../components/ListView';
import { ChatView } from '../components/ChatView';
import { SettingsView } from '../components/SettingsView';

@Entry
@Component
struct Index {
  @StorageProp('route') route: string = Routes.SPLASH;
  @StorageProp('bannerVisible') bannerVisible: boolean = false;
  @StorageProp('bannerTitle') bannerTitle: string = '';
  @StorageProp('bannerBody') bannerBody: string = '';
  @StorageProp('error') error: string = '';
  @StorageProp('lang') lang: string = '';

  @State showType: boolean = false;
  @State typeText: string = '';
  @State showServer: boolean = false;
  @State serverText: string = '';

  onBackPress(): boolean {
    if (this.showType) {
      this.showType = false;
      return true;
    }
    if (this.showServer) {
      this.showServer = false;
      return true;
    }
    return Net.instance.onBack();
  }

  // ---- Speak: on-device transcription, then send text only ----
  private startSpeak(): void {
    const ctx: common.UIAbilityContext | null = Net.instance.getContext();
    if (ctx === null) {
      this.openType();
      return;
    }
    Speech.recognize(ctx, this.lang)
      .then((text: string) => {
        if (text.length > 0) {
          Net.instance.sendPrompt(text);
        }
      })
      .catch((e: Object) => {
        // Speech unavailable / denied — fall back to the keyboard sheet.
        promptAction.showToast({ message: 'Voice unavailable — type instead', duration: 1600 });
        this.openType();
      });
  }

  private openType(): void {
    this.typeText = '';
    this.showType = true;
  }

  private openServer(): void {
    this.serverText = '';
    this.showServer = true;
  }

  @Builder
  router() {
    if (this.route === Routes.SPLASH) {
      SplashView()
    } else if (this.route === Routes.PAIRING) {
      PairingView({ onEditServer: () => this.openServer() })
    } else if (this.route === Routes.CONNECT) {
      ConnectView()
    } else if (this.route === Routes.CONSENT) {
      ConsentView()
    } else if (this.route === Routes.HOME) {
      HomeView()
    } else if (this.route === Routes.LIST) {
      ListView()
    } else if (this.route === Routes.CHAT) {
      ChatView({ onSpeak: () => this.startSpeak(), onType: () => this.openType() })
    } else if (this.route === Routes.SETTINGS) {
      SettingsView({ onEditServer: () => this.openServer() })
    } else {
      SplashView()
    }
  }

  @Builder
  inputSheet(title: string, placeholder: string, value: string, onCommit: (v: string) => void, onCancel: () => void) {
    Column({ space: 10 }) {
      Text(title)
        .fontSize(13)
        .fontColor(C.muted)
      TextInput({ placeholder: placeholder, text: value })
        .fontSize(15)
        .fontColor(C.ink)
        .backgroundColor(C.surface2)
        .placeholderColor(C.faint)
        .borderRadius(14)
        .width('86%')
        .padding({ left: 12, right: 12, top: 8, bottom: 8 })
        .onChange((v: string) => onCommit(v))
      Row({ space: 12 }) {
        Text('Cancel')
          .fontSize(14)
          .fontColor(C.ink)
          .backgroundColor(C.surface2)
          .borderRadius(18)
          .padding({ left: 18, right: 18, top: 7, bottom: 7 })
          .onClick(() => onCancel())
        Text('Send')
          .fontSize(14)
          .fontColor(C.onClay)
          .backgroundColor(C.clay)
          .borderRadius(18)
          .padding({ left: 22, right: 22, top: 7, bottom: 7 })
          .onClick(() => this.commitSheet())
      }
    }
    .justifyContent(FlexAlign.Center)
    .width('100%')
    .height('100%')
    .padding({ left: 16, right: 16 })
    .backgroundColor(C.scrim)
  }

  private commitSheet(): void {
    if (this.showType) {
      const t: string = this.typeText.trim();
      this.showType = false;
      if (t.length > 0) {
        Net.instance.sendPrompt(t);
      }
    } else if (this.showServer) {
      const s: string = this.serverText.trim();
      this.showServer = false;
      if (s.length > 0) {
        Net.instance.setServer(s);
      }
    }
  }

  build() {
    Stack({ alignContent: Alignment.TopStart }) {
      Column() {
        this.router()
      }
      .width('100%')
      .height('100%')

      // Top banner (watch_action notify / timer / query results).
      if (this.bannerVisible) {
        Column({ space: 2 }) {
          Text(this.bannerTitle)
            .fontSize(14)
            .fontColor(C.ink)
            .textAlign(TextAlign.Center)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          if (this.bannerBody.length > 0) {
            Text(this.bannerBody)
              .fontSize(12)
              .fontColor(C.muted)
              .textAlign(TextAlign.Center)
              .maxLines(2)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
          }
        }
        .width('82%')
        .padding(12)
        .backgroundColor(C.surface2)
        .borderRadius(18)
        .position({ x: '9%', y: 30 })
      }

      // Bottom transient error toast.
      if (this.error.length > 0) {
        Text(this.error)
          .fontSize(12)
          .fontColor(C.err)
          .textAlign(TextAlign.Center)
          .maxLines(2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('82%')
          .padding(8)
          .backgroundColor('#2A1A16')
          .borderRadius(14)
          .position({ x: '9%', y: '80%' })
      }

      // Compose sheets.
      if (this.showType) {
        this.inputSheet('Message', 'Type to Claude', this.typeText,
          (v: string) => { this.typeText = v; },
          () => { this.showType = false; })
      }
      if (this.showServer) {
        this.inputSheet('Server URL', 'your-app.onrender.com', this.serverText,
          (v: string) => { this.serverText = v; },
          () => { this.showServer = false; })
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor(C.bg)
  }
}
