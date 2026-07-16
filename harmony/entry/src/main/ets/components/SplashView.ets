import { C, SERIF } from '../model/Theme';
import { Spark } from './Common';

@Component
export struct SplashView {
  @State angle: number = 0;
  @State glow: number = 0.92;

  aboutToAppear(): void {
    animateTo({ duration: 18000, curve: Curve.Linear, iterations: -1, playMode: PlayMode.Normal }, () => {
      this.angle = 360;
    });
    animateTo({ duration: 2400, curve: Curve.Linear, iterations: -1, playMode: PlayMode.Alternate }, () => {
      this.glow = 1.08;
    });
  }

  build() {
    Column({ space: 14 }) {
      Spark({ sparkSize: 74 })
        .rotate({ angle: this.angle })
        .scale({ x: this.glow, y: this.glow })
      Text('Claude')
        .fontFamily(SERIF)
        .fontSize(26)
        .fontWeight(FontWeight.Medium)
        .fontColor(C.ink)
    }
    .justifyContent(FlexAlign.Center)
    .width('100%')
    .height('100%')
  }
}
