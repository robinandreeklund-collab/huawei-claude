import { C } from '../model/Theme';
import { ChatMsg, Roles } from '../model/Types';
import { Net } from '../net/Net';

@Component
export struct ChatView {
  @StorageProp('chatTitle') chatTitle: string = 'Claude';
  @StorageLink('messages') @Watch('onFeed') messages: ChatMsg[] = [];
  @StorageProp('typing') @Watch('onFeed') typing: boolean = false;
  @StorageProp('running') running: boolean = false;
  @StorageProp('status') status: string = '';
  @StorageProp('suggestion') suggestion: string = '';
  @StorageProp('confirmId') confirmId: string = '';
  @StorageProp('confirmTool') confirmTool: string = '';
  @StorageProp('confirmCommand') confirmCommand: string = '';
  onSpeak: () => void = () => {};
  onType: () => void = () => {};
  private scroller: Scroller = new Scroller();

  onFeed(): void {
    // Keep the newest bubble in view as the stream grows / typing toggles.
    setTimeout(() => {
      try {
        this.scroller.scrollEdge(Edge.Bottom);
      } catch (e) {
      }
    }, 0);
  }

  @Builder
  bubble(m: ChatMsg) {
    if (m.role === Roles.ME) {
      Row() {
        Text(m.text)
          .fontSize(14)
          .fontColor(C.onClay)
          .backgroundColor(C.clay)
          .borderRadius(18)
          .padding({ left: 10, right: 10, top: 7, bottom: 7 })
          .constraintSize({ maxWidth: '74%' })
      }
      .width('100%')
      .justifyContent(FlexAlign.End)
      .padding({ top: 3, bottom: 3, left: 8, right: 8 })
    } else if (m.role === Roles.AI) {
      Row() {
        if (m.streaming) {
          Text() {
            Span(m.text)
            Span(' ▍').fontColor(C.clay).fontWeight(FontWeight.Bold)
          }
          .fontSize(14)
          .fontColor(m.filtered ? C.filteredFg : C.ink)
          .backgroundColor(m.filtered ? C.filteredBg : C.surface)
          .borderRadius(18)
          .padding({ left: 10, right: 10, top: 7, bottom: 7 })
          .constraintSize({ maxWidth: '74%' })
        } else {
          Text(m.text)
            .fontSize(14)
            .fontColor(m.filtered ? C.filteredFg : C.ink)
            .backgroundColor(m.filtered ? C.filteredBg : C.surface)
            .borderRadius(18)
            .padding({ left: 10, right: 10, top: 7, bottom: 7 })
            .constraintSize({ maxWidth: '74%' })
        }
      }
      .width('100%')
      .justifyContent(FlexAlign.Start)
      .padding({ top: 3, bottom: 3, left: 8, right: 8 })
    } else {
      Row() {
        Text('⌘ ' + m.text)
          .fontSize(11)
          .fontFamily('monospace')
          .fontColor(C.clay)
          .backgroundColor(C.surface)
          .borderRadius(12)
          .padding({ left: 8, right: 8, top: 5, bottom: 5 })
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .constraintSize({ maxWidth: '74%' })
      }
      .width('100%')
      .justifyContent(FlexAlign.Start)
      .padding({ top: 3, bottom: 3, left: 8, right: 8 })
    }
  }

  @Builder
  dock() {
    Column({ space: 4 }) {
      if (this.status.length > 0) {
        Text(this.status)
          .fontSize(10)
          .fontColor(C.muted)
          .maxLines(1)
      }
      if (this.suggestion.length > 0) {
        Text(this.suggestion)
          .fontSize(13)
          .fontColor(C.ink)
          .backgroundColor(C.surface2)
          .borderRadius(16)
          .padding({ left: 12, right: 12, top: 6, bottom: 6 })
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .constraintSize({ maxWidth: '80%' })
          .onClick(() => {
            const s: string = this.suggestion;
            Net.instance.sendPrompt(s);
          })
      }
      if (this.running) {
        Text('Stop')
          .fontSize(14)
          .fontColor(C.ink)
          .backgroundColor(C.surface2)
          .borderRadius(18)
          .padding({ left: 22, right: 22, top: 7, bottom: 7 })
          .onClick(() => Net.instance.stop())
      } else {
        Row({ space: 10 }) {
          Text('Speak')
            .fontSize(14)
            .fontColor(C.onClay)
            .backgroundColor(C.clay)
            .borderRadius(18)
            .padding({ left: 18, right: 18, top: 7, bottom: 7 })
            .onClick(() => this.onSpeak())
          Text('Type')
            .fontSize(14)
            .fontColor(C.ink)
            .backgroundColor(C.surface2)
            .borderRadius(18)
            .padding({ left: 18, right: 18, top: 7, bottom: 7 })
            .onClick(() => this.onType())
        }
      }
    }
    .width('100%')
    .padding({ bottom: 12 })
  }

  @Builder
  confirmOverlay() {
    Column({ space: 8 }) {
      Text('Run ' + this.confirmTool + '?')
        .fontSize(15)
        .fontWeight(FontWeight.Medium)
        .fontColor(C.confirmTitle)
        .textAlign(TextAlign.Center)
      Text(this.confirmCommand)
        .fontSize(11)
        .fontFamily('monospace')
        .fontColor(C.confirmFg)
        .backgroundColor(C.confirmBg)
        .borderRadius(10)
        .padding(8)
        .maxLines(4)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .constraintSize({ maxWidth: '86%' })
      Row({ space: 10 }) {
        Text('Allow')
          .fontSize(14)
          .fontColor(C.onClay)
          .backgroundColor(C.clay)
          .borderRadius(18)
          .padding({ left: 20, right: 20, top: 7, bottom: 7 })
          .onClick(() => Net.instance.resolveConfirm(true))
        Text('Deny')
          .fontSize(14)
          .fontColor(C.ink)
          .backgroundColor(C.surface2)
          .borderRadius(18)
          .padding({ left: 20, right: 20, top: 7, bottom: 7 })
          .onClick(() => Net.instance.resolveConfirm(false))
      }
    }
    .justifyContent(FlexAlign.Center)
    .width('100%')
    .height('100%')
    .padding({ left: 18, right: 18 })
    .backgroundColor(C.scrim)
  }

  build() {
    Stack({ alignContent: Alignment.Bottom }) {
      List({ space: 0, scroller: this.scroller }) {
        ListItem() {
          Text(this.chatTitle)
            .fontSize(12)
            .fontWeight(FontWeight.Medium)
            .fontColor(C.clay)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .width('100%')
            .textAlign(TextAlign.Center)
        }

        ForEach(this.messages, (m: ChatMsg) => {
          ListItem() {
            this.bubble(m)
          }
        }, (m: ChatMsg) => m.key.toString())

        if (this.typing) {
          ListItem() {
            Row() {
              Text('•••')
                .fontSize(14)
                .fontColor(C.muted)
                .backgroundColor(C.surface)
                .borderRadius(16)
                .padding({ left: 12, right: 12, top: 8, bottom: 8 })
            }
            .width('100%')
            .justifyContent(FlexAlign.Start)
            .padding({ left: 8 })
          }
        }
      }
      .width('100%')
      .height('100%')
      .scrollBar(BarState.Off)
      .edgeEffect(EdgeEffect.Spring)
      .contentStartOffset(40)
      .contentEndOffset(92)

      if (this.confirmId.length > 0) {
        this.confirmOverlay()
      } else {
        this.dock()
      }
    }
    .width('100%')
    .height('100%')
  }
}
