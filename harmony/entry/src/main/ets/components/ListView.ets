import { C, SERIF } from '../model/Theme';
import { RowChip } from './Common';
import { ListItem } from '../model/Types';
import { Net } from '../net/Net';

@Component
export struct ListView {
  @StorageProp('scopeTitle') scopeTitle: string = '';
  @StorageProp('currentScope') currentScope: string = '';
  @StorageProp('listLoading') listLoading: boolean = true;
  @StorageLink('listItems') listItems: ListItem[] = [];

  build() {
    Stack() {
      if (this.listLoading) {
        LoadingProgress()
          .width(40)
          .height(40)
          .color(C.clay)
      } else {
        Scroll() {
          Column({ space: 8 }) {
            Text(this.scopeTitle.length > 0 ? this.scopeTitle : 'Chats')
              .fontFamily(SERIF)
              .fontSize(18)
              .fontWeight(FontWeight.Medium)
              .fontColor(C.ink)

            if (this.currentScope === 'chats') {
              RowChip({
                label: 'New chat',
                secondary: '',
                labelColor: C.onClay,
                bg: C.clay,
                onTap: () => Net.instance.newChat()
              })
            }

            if (this.listItems.length === 0) {
              Text('Nothing here yet')
                .fontSize(12)
                .fontColor(C.faint)
                .margin({ top: 6 })
            } else {
              ForEach(this.listItems, (it: ListItem) => {
                RowChip({
                  label: it.title,
                  secondary: it.subtitle,
                  labelColor: C.ink,
                  secondaryColor: C.faint,
                  bg: C.surface,
                  onTap: () => Net.instance.openItem(it.id)
                })
              }, (it: ListItem) => it.id)
            }
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
    .width('100%')
    .height('100%')
  }
}
