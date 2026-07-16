import { image } from '@kit.ImageKit';
import { C, SERIF } from '../model/Theme';
import { QrCard } from './Common';

// Shown when the watch is paired but no Claude credential is connected yet.
@Component
export struct ConnectView {
  @StorageProp('connectQr') connectQr: image.PixelMap | null = null;
  @StorageProp('connectHost') connectHost: string = '';

  build() {
    Scroll() {
      Column({ space: 8 }) {
        Text('Connect Claude')
          .fontFamily(SERIF)
          .fontSize(18)
          .fontWeight(FontWeight.Medium)
          .fontColor(C.ink)
        QrCard({ pm: this.connectQr, cardSize: 122 })
        Text('Scan to open')
          .fontSize(11)
          .fontColor(C.muted)
          .textAlign(TextAlign.Center)
        Text(this.connectHost + '/connect')
          .fontSize(13)
          .fontWeight(FontWeight.Medium)
          .fontColor(C.clay)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .padding({ left: 12, right: 12 })
        Text('on your phone and paste your Claude token once.')
          .fontSize(11)
          .fontColor(C.muted)
          .textAlign(TextAlign.Center)
          .padding({ left: 18, right: 18 })
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
