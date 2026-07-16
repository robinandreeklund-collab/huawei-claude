import { http } from '@kit.NetworkKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { parseObj } from '../util/Json';

// Thin HTTP client for the device-flow login + connect-status + meta endpoints.
// Every response is coerced into Record<string, Object>; failures yield {}.
export class Http {
  static async post(url: string, body: Record<string, Object>): Promise<Record<string, Object>> {
    const req: http.HttpRequest = http.createHttp();
    try {
      const options: http.HttpRequestOptions = {
        method: http.RequestMethod.POST,
        header: { 'Content-Type': 'application/json' } as Record<string, string>,
        extraData: JSON.stringify(body),
        connectTimeout: 15000,
        readTimeout: 20000,
        expectDataType: http.HttpDataType.STRING
      };
      const resp: http.HttpResponse = await req.request(url, options);
      return Http.body(resp);
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      throw new Error('http_post_failed:' + (err ? err.code : -1));
    } finally {
      req.destroy();
    }
  }

  static async get(url: string): Promise<Record<string, Object>> {
    const req: http.HttpRequest = http.createHttp();
    try {
      const options: http.HttpRequestOptions = {
        method: http.RequestMethod.GET,
        connectTimeout: 15000,
        readTimeout: 20000,
        expectDataType: http.HttpDataType.STRING
      };
      const resp: http.HttpResponse = await req.request(url, options);
      return Http.body(resp);
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      throw new Error('http_get_failed:' + (err ? err.code : -1));
    } finally {
      req.destroy();
    }
  }

  private static body(resp: http.HttpResponse): Record<string, Object> {
    const result: string | Object | ArrayBuffer = resp.result;
    const text: string = typeof result === 'string' ? (result as string) : '';
    return parseObj(text);
  }
}
