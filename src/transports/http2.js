import http2 from 'http2';
import {TcpInbound, TcpOutbound} from './tcp';
import {logger} from '../utils';

export class Http2Inbound extends TcpInbound {

}

export class Http2Outbound extends TcpOutbound {

  // overwrite _connect of tcp outbound using http2.connect()
  async _connect({host, port}) {
    logger.info(`[http2:outbound] [${this.remote}] connecting to: ${host}:${port}`);
    const session = http2.connect(`https://${host}:${port}`, {ca: [__TLS_CERT__]});
    return new Promise((resolve) => {
      session.on('connect', () => {
        resolve(session.socket);
      });
    });
  }

}
