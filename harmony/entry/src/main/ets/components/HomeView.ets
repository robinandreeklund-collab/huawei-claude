import { C, SERIF } from '../model/Theme';
import { RowChip } from './Common';
import { Scope } from '../model/Types';
import { Net } from '../net/Net';

@Component
export struct HomeView {
  private scopes: Scope[] = Scope.all();

  build() {
    Scroll() {
      Column({ space: 8 }) {
        ForEach(this.scopes, (scope: Scope) => {
          RowChip({
            label: scope.title,
            secondary: scope.subtitle,
            labelColor: C.ink,
            secondaryColor: C.faint,
            bg: C.surface,
            onTap: () => Net.instance.openScope(scope)
          })
        }, (scope: Scope) => scope.key)
        RowChip({
          label: 'Settings',
          secondary: '',
          labelColor: C.muted,
          bg: C.surface,
          onTap: () => Net.instance.openSettings()
        })
        Text('·')
          .fontFamily(SERIF)
          .fontSize(16)
          .fontColor(C.clay)
          .margin({ top: 2 })
      }
      .width('100%')
      .padding({ top: 34, bottom: 44 })
    }
    .width('100%')
    .height('100%')
    .scrollBar(BarState.Off)
    .edgeEffect(EdgeEffect.Spring)
  }
}
