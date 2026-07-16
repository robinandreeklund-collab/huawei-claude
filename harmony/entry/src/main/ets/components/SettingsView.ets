import { C, SERIF } from '../model/Theme';
import { RowChip } from './Common';
import { LangOption } from '../model/Types';
import { Net } from '../net/Net';

@Component
export struct SettingsView {
  @StorageProp('acctEmail') acctEmail: string = '';
  @StorageProp('acctPlan') acctPlan: string = '';
  @StorageProp('lang') lang: string = '';
  @StorageProp('planMode') planMode: boolean = false;
  @StorageProp('notifications') notifications: boolean = true;
  @StorageProp('connectHost') connectHost: string = '';
  onEditServer: () => void = () => {};
  private langs: LangOption[] = LangOption.all();

  build() {
    Scroll() {
      Column({ space: 10 }) {
        Text('Settings')
          .fontFamily(SERIF)
          .fontSize(18)
          .fontWeight(FontWeight.Medium)
          .fontColor(C.ink)

        // Account card
        RowChip({
          label: this.acctEmail.length > 0 ? this.acctEmail : 'Signed in',
          secondary: this.acctPlan.length > 0 ? this.acctPlan : 'verifying…',
          labelColor: C.ink,
          secondaryColor: C.clay,
          bg: C.surface,
          onTap: () => {}
        })

        Text('Language')
          .fontSize(11)
          .fontColor(C.muted)

        Row({ space: 6 }) {
          ForEach(this.langs, (opt: LangOption) => {
            Text(opt.label)
              .fontSize(13)
              .fontColor(this.lang === opt.code ? C.onClay : C.ink)
              .padding({ left: 14, right: 14, top: 6, bottom: 6 })
              .backgroundColor(this.lang === opt.code ? C.clay : C.surface2)
              .borderRadius(16)
              .onClick(() => Net.instance.setLanguage(opt.code))
          }, (opt: LangOption) => opt.code)
        }

        // Plan mode toggle
        Row() {
          Column() {
            Text('Plan mode')
              .fontSize(15)
              .fontColor(C.ink)
              .width('100%')
              .textAlign(TextAlign.Start)
            Text('review before edits')
              .fontSize(11)
              .fontColor(C.faint)
              .width('100%')
              .textAlign(TextAlign.Start)
          }
          .layoutWeight(1)
          .alignItems(HorizontalAlign.Start)
          Toggle({ type: ToggleType.Switch, isOn: this.planMode })
            .selectedColor(C.clay)
            .onChange((on: boolean) => Net.instance.setPlanMode(on))
        }
        .width('82%')
        .padding({ left: 16, right: 12, top: 8, bottom: 8 })
        .backgroundColor(C.surface)
        .borderRadius(22)

        // Notifications toggle
        Row() {
          Text('Notifications')
            .fontSize(15)
            .fontColor(C.ink)
            .layoutWeight(1)
            .textAlign(TextAlign.Start)
          Toggle({ type: ToggleType.Switch, isOn: this.notifications })
            .selectedColor(C.clay)
            .onChange((on: boolean) => Net.instance.setNotifications(on))
        }
        .width('82%')
        .padding({ left: 16, right: 12, top: 8, bottom: 8 })
        .backgroundColor(C.surface)
        .borderRadius(22)

        // Server row
        RowChip({
          label: 'Server',
          secondary: this.connectHost,
          labelColor: C.muted,
          secondaryColor: C.faint,
          bg: C.surface,
          onTap: () => this.onEditServer()
        })
      }
      .width('100%')
      .padding({ top: 30, bottom: 44 })
    }
    .width('100%')
    .height('100%')
    .scrollBar(BarState.Off)
    .edgeEffect(EdgeEffect.Spring)
  }
}
