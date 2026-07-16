import { image } from '@kit.ImageKit';
import { C, SERIF } from '../model/Theme';
import { QrCard } from './Common';

@Component
export struct PairingView {
  @StorageProp('userCode') userCode: string = '';
  @StorageProp('pairQr') pairQr: image.PixelMap | null = null;
  @StorageProp('connectHost') connectHost: string = '';
  onEditServer: () => void = () => {};

  build() {
    Scroll() {
      Column({ space: 10 }) {
        Text('Pair')
          .fontFamily(SERIF)
          .fontSize(22)
          .fontWeight(FontWeight.Medium)
          .fontColor(C.ink)
        QrCard({ pm: this.pairQr, cardSize: 122 })
        Text(this.userCode.length > 0 ? this.userCode : '· · · ·')
          .fontFamily(SERIF)
          .fontSize(20)
          .fontColor(C.ink)
          .margin({ top: 2, bottom: 2 })
        Text('Scan with your phone and approve.')
          .fontSize(11)
          .fontColor(C.muted)
          .textAlign(TextAlign.Center)
          .padding({ left: 20, right: 20 })
        Row() {
          Text('⚙ ' + this.connectHost)
            .fontSize(12)
            .fontColor(C.muted)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        .padding({ left: 14, right: 14, top: 7, bottom: 7 })
        .backgroundColor(C.surface2)
        .borderRadius(16)
        .onClick(() => this.onEditServer())
      }
      .width('100%')
      .padding({ top: 26, bottom: 40 })
    }
    .width('100%')
    .height('100%')
    .scrollBar(BarState.Off)
    .edgeEffect(EdgeEffect.Spring)
  }
}
