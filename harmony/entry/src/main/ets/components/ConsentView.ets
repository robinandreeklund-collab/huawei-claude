import { C, SERIF } from '../model/Theme';
import { Spark } from './Common';
import { Net } from '../net/Net';

@Component
export struct ConsentView {
  build() {
    Scroll() {
      Column({ space: 10 }) {
        Spark({ sparkSize: 34 })
        Text('Before we start')
          .fontFamily(SERIF)
          .fontSize(18)
          .fontWeight(FontWeight.Medium)
          .fontColor(C.ink)
          .margin({ top: 6 })
        Text('What you say is sent to the backend and Anthropic to run Claude Code.')
          .fontSize(12)
          .fontColor(C.muted)
          .textAlign(TextAlign.Center)
          .padding({ left: 20, right: 20 })
          .margin({ top: 4, bottom: 6 })
        Button('Agree')
          .fontSize(15)
          .fontColor(C.onClay)
          .backgroundColor(C.clay)
          .borderRadius(24)
          .padding({ left: 26, right: 26, top: 8, bottom: 8 })
          .onClick(() => Net.instance.consent())
      }
      .width('100%')
      .padding({ top: 30, bottom: 40 })
    }
    .width('100%')
    .height('100%')
    .scrollBar(BarState.Off)
    .edgeEffect(EdgeEffect.Spring)
  }
}
