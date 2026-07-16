import { image } from '@kit.ImageKit';
import { C, sparkPath } from '../model/Theme';

// The Claude 4-point spark, drawn from SVG path commands.
@Component
export struct Spark {
  sparkSize: number = 40;
  color: string = C.clay;

  build() {
    Path()
      .commands(sparkPath(this.sparkSize))
      .fill(this.color)
      .stroke(Color.Transparent)
      .strokeWidth(0)
      .width(this.sparkSize)
      .height(this.sparkSize)
  }
}

// A QR code (backend base64 PNG, already decoded to a PixelMap) on a white card.
@Component
export struct QrCard {
  pm: image.PixelMap | null = null;
  cardSize: number = 120;

  build() {
    Stack() {
      if (this.pm !== null) {
        Image(this.pm)
          .width(this.cardSize - 12)
          .height(this.cardSize - 12)
          .objectFit(ImageFit.Contain)
          .interpolation(ImageInterpolation.None)
      } else {
        LoadingProgress()
          .width(36)
          .height(36)
          .color(C.clay)
      }
    }
    .width(this.cardSize)
    .height(this.cardSize)
    .backgroundColor(Color.White)
    .borderRadius(14)
    .padding(6)
  }
}

// A pill chip used across Home / List / Settings.
@Component
export struct RowChip {
  label: string = '';
  secondary: string = '';
  labelColor: string = C.ink;
  secondaryColor: string = C.faint;
  bg: string = C.surface;
  onTap: () => void = () => {};

  build() {
    Column() {
      Text(this.label)
        .fontSize(15)
        .fontColor(this.labelColor)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .width('100%')
        .textAlign(TextAlign.Start)
      if (this.secondary.length > 0) {
        Text(this.secondary)
          .fontSize(11)
          .fontColor(this.secondaryColor)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
          .textAlign(TextAlign.Start)
          .margin({ top: 2 })
      }
    }
    .alignItems(HorizontalAlign.Start)
    .width('82%')
    .padding({ left: 16, right: 16, top: 11, bottom: 11 })
    .backgroundColor(this.bg)
    .borderRadius(22)
    .onClick(() => this.onTap())
  }
}
