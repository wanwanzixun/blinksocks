import crypto from 'crypto';
import ip from 'ip';
import {EVP_BytesToKey, numberToBuffer, hmac} from '../utils';
import {IPreset, SOCKET_CONNECT_TO_DST} from './defs';

const ATYP_V4 = 0x01;
const ATYP_V6 = 0x04;

const IV_LEN = 16;
const HMAC_LEN = 16;

// available ciphers
const ciphers = [
  'aes-128-ctr', 'aes-192-ctr', 'aes-256-ctr',
  'aes-128-cfb', 'aes-192-cfb', 'aes-256-cfb',
  'camellia-128-cfb', 'camellia-192-cfb', 'camellia-256-cfb'
];

/**
 * @description
 *   Delivery destination address(ip/hostname) and port with authorization and stream encryption.
 *
 * @params
 *   no
 *
 * @examples
 *   {
 *     "name": "exp-base-auth-stream",
 *     "params": {
 *       "method": "aes-256-ctr"
 *     }
 *   }
 *
 * @protocol
 *
 *   # Client => Server, TCP stream
 *   +----------+-----------+------+----------+----------+----------+---------+
 *   |    IV    | HMAC-SHA1 | ALEN | DST.ADDR | DST.PORT |   DATA   |   ...   |
 *   +----------+-----------+------+----------+----------+----------+---------+
 *   |    16    |    16     |  1   | Variable |    2     | Variable |   ...   |
 *   +----------+-----------+------+----------+----------+----------+---------+
 *
 *   # After handshake
 *   +----------+
 *   |   DATA   |
 *   +----------+
 *   | Variable |
 *   +----------+
 *
 * @explain
 *   1. HMAC-SHA1 = HMAC(ALEN + DST.ADDR + DST.PORT), key is (IV ^ EVP_BytesToKey(rawKey, keyLen, 16)).
 *   2. ALEN = len(DST.ADDR).
 *   3. Encrypt-then-Mac(EtM) is performed to calculate HMAC.
 *   4. The initial stream MUST contain a DATA chunk followed by [ALEN, DST.ADDR, DST.PORT].
 */
export default class ExpBaseAuthStreamPreset extends IPreset {

  _isHandshakeDone = false;

  _host = null; // buffer

  _port = null; // buffer

  _cipherName = '';

  _key = null;

  _cipher = null;

  _decipher = null;

  constructor({type, host, port, method}) {
    super();
    if (typeof method !== 'string' || method === '') {
      throw Error('\'method\' must be set');
    }
    if (!ciphers.includes(method)) {
      throw Error(`method '${method}' is not supported.`);
    }
    if (__IS_CLIENT__) {
      this._host = host;
      this._port = port;
      if (type === ATYP_V4 || type === ATYP_V6) {
        this._host = Buffer.from(ip.toString(host));
      }
    }
    this._cipherName = method;
    if (global.__KEY__) {
      this._key = EVP_BytesToKey(__KEY__, this._cipherName.split('-')[1] / 8, IV_LEN);
    }
  }

  clientOut({buffer}) {
    if (!this._isHandshakeDone) {
      this._isHandshakeDone = true;

      // initialize (de)cipher
      const iv = crypto.randomBytes(IV_LEN);
      this._cipher = crypto.createCipheriv(this._cipherName, this._key, iv);
      this._decipher = crypto.createDecipheriv(this._cipherName, this._key, iv);

      const encBuf = this.encrypt(
        Buffer.concat([numberToBuffer(this._host.length, 1), this._host, this._port, buffer])
      );
      const hmacEncAddr = hmac('sha1', this._key, encBuf.slice(0, -buffer.length)).slice(0, HMAC_LEN);

      return Buffer.concat([iv, hmacEncAddr, encBuf]);
    } else {
      return this.encrypt(buffer);
    }
  }

  serverIn({buffer, next, broadcast, fail}) {
    if (!this._isHandshakeDone) {
      // minimal length required
      if (buffer.length < 37) {
        return fail(`unexpected buffer length_1: ${buffer.length}, buffer=${buffer.toString('hex')}`);
      }

      // initialize (de)cipher
      const iv = buffer.slice(0, IV_LEN);
      this._cipher = crypto.createCipheriv(this._cipherName, this._key, iv);
      this._decipher = crypto.createDecipheriv(this._cipherName, this._key, iv);

      // decrypt tail
      const tailBuffer = this.decrypt(buffer.slice(32));

      // obtain HMAC and ALEN
      const hmacTag = buffer.slice(16, 32);
      const alen = tailBuffer[0];

      // verify length
      if (buffer.length <= 35 + alen) {
        return fail(`unexpected buffer length_2: ${buffer.length}, buffer=${buffer.toString('hex')}`);
      }

      // verify HMAC
      const expHmac = hmac('sha1', this._key, buffer.slice(32, 35 + alen)).slice(0, HMAC_LEN);
      if (!expHmac.equals(hmacTag)) {
        return fail(`unexpected HMAC-SHA1=${hmacTag.toString('hex')} want=${expHmac.toString('hex')}`);
      }

      // obtain addr, port and data
      const addr = tailBuffer.slice(1, alen + 1).toString();
      const port = tailBuffer.slice(alen + 1, alen + 3).readUInt16BE(0);
      const data = tailBuffer.slice(alen + 3);

      // notify to connect to the real server
      broadcast({
        type: SOCKET_CONNECT_TO_DST,
        payload: {
          targetAddress: {
            host: addr,
            port
          },
          // once connected
          onConnected: () => {
            next(data);
            this._isHandshakeDone = true;
          }
        }
      });
    } else {
      return this.decrypt(buffer);
    }
  }

  serverOut({buffer}) {
    return this.encrypt(buffer);
  }

  clientIn({buffer}) {
    return this.decrypt(buffer);
  }

  encrypt(buffer) {
    return this._cipher.update(buffer);
  }

  decrypt(buffer) {
    return this._decipher.update(buffer);
  }

}