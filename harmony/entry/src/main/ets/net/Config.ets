import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';

// Where the relay backend lives. Baked default, overridable at runtime and
// persisted via the ⚙ Server field on the pairing / settings screens.
export class Config {
  static readonly DEFAULT_BASE: string = 'https://huawei-claude-backend-uzd9.onrender.com';
  private static readonly STORE: string = 'claude';
  private static readonly KEY: string = 'base';

  static normalize(u: string): string {
    let s: string = u.trim();
    while (s.endsWith('/')) {
      s = s.substring(0, s.length - 1);
    }
    if (!s.startsWith('http://') && !s.startsWith('https://')) {
      s = 'https://' + s;
    }
    return s;
  }

  static wsUrl(base: string): string {
    if (base.startsWith('https://')) {
      return 'wss://' + base.substring(8) + '/ws';
    }
    if (base.startsWith('http://')) {
      return 'ws://' + base.substring(7) + '/ws';
    }
    return base + '/ws';
  }

  static host(base: string): string {
    let s: string = base;
    if (s.startsWith('https://')) {
      s = s.substring(8);
    } else if (s.startsWith('http://')) {
      s = s.substring(7);
    }
    return s;
  }

  static async load(ctx: common.UIAbilityContext): Promise<string> {
    try {
      const options: preferences.Options = { name: Config.STORE };
      const pref: preferences.Preferences = await preferences.getPreferences(ctx, options);
      const saved: preferences.ValueType = await pref.get(Config.KEY, '');
      const s: string = typeof saved === 'string' ? (saved as string) : '';
      const chosen: string = s.length > 0 ? s : Config.DEFAULT_BASE;
      return Config.normalize(chosen);
    } catch (e) {
      return Config.normalize(Config.DEFAULT_BASE);
    }
  }

  static async save(ctx: common.UIAbilityContext, url: string): Promise<void> {
    try {
      const options: preferences.Options = { name: Config.STORE };
      const pref: preferences.Preferences = await preferences.getPreferences(ctx, options);
      await pref.put(Config.KEY, Config.normalize(url));
      await pref.flush();
    } catch (e) {
      // best effort — the in-memory base still updates
    }
  }
}
