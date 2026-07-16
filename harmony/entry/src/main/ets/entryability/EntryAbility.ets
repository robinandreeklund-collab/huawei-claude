import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { window } from '@kit.ArkUI';
import { Net } from '../net/Net';

const TAG: string = 'ClaudeWatch';
const DOMAIN: number = 0x0001;

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    hilog.info(DOMAIN, TAG, 'EntryAbility onCreate');
    // Hand the ability context to the connection singleton so it can reach
    // preferences (server URL), permissions (mic), haptics and Push Kit.
    Net.instance.attachContext(this.context);
  }

  onDestroy(): void {
    hilog.info(DOMAIN, TAG, 'EntryAbility onDestroy');
    Net.instance.dispose();
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    hilog.info(DOMAIN, TAG, 'onWindowStageCreate');
    windowStage.loadContent('pages/Index', (err) => {
      if (err.code) {
        hilog.error(DOMAIN, TAG, 'loadContent failed: %{public}s', JSON.stringify(err));
        return;
      }
      // Draw edge-to-edge so the round watch face is fully used.
      try {
        const win = windowStage.getMainWindowSync();
        win.setWindowLayoutFullScreen(true);
      } catch (e) {
        hilog.warn(DOMAIN, TAG, 'fullscreen not available');
      }
      // Kick off the boot sequence: splash -> device-flow pairing.
      Net.instance.boot();
    });
  }

  onWindowStageDestroy(): void {
    hilog.info(DOMAIN, TAG, 'onWindowStageDestroy');
  }

  onForeground(): void {
    Net.instance.onForeground();
  }

  onBackground(): void {
    Net.instance.onBackground();
  }
}
