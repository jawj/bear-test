
import { bearssl_emscripten } from './bearssl.js';

declare global {
    const WS2S: any;
}

export default (async function (host, port) {
    let module: any;
    let socket: any;

    const incomingDataQueue: Uint8Array[] = []
    let emBuf: number /* pointer */ | null = null;
    let emMaxSize = 0;
    let emResolve: null | ((number) => void) = null;

    function dequeueIncomingData() {
        if (incomingDataQueue.length === 0 || emResolve === null || emBuf === null) return;

        let nextData = incomingDataQueue[0];
        if (nextData.length > emMaxSize) {
            incomingDataQueue[0] = nextData.subarray(emMaxSize);
            nextData = nextData.subarray(0, emMaxSize);

        } else {
            incomingDataQueue.shift();
        }

        module.HEAPU8.set(nextData, emBuf);

        const resolve = emResolve;
        emResolve = emBuf = null;
        emMaxSize = 0;
        
        resolve(nextData.length);
    }

    function toFriendlyHex(arr) {
        return arr.reduce((memo, x) => memo + (x < 16 ? ' 0' : ' ') + x.toString(16), '');
    }

    module = await bearssl_emscripten({
        provideEncryptedFromNetwork(buf, maxSize) {
            console.info(`provideEncryptedFromNetwork: providing up to ${maxSize} bytes`);

            emBuf = buf;
            emMaxSize = maxSize;
            const promise = new Promise(resolve => emResolve = resolve);

            dequeueIncomingData();
            return promise;
        },
        writeEncryptedToNetwork(buf, size) {
            console.info(`writeEncryptedToNetwork: writing ${size} bytes`);

            const arr = module.HEAPU8.subarray(buf, buf + size);
            socket.sendb(arr);

            return size;
        },

        /* for Cloudflare workers we'd use something like: */
        
        // instantiateWasm(info, receive) {
        //     let instance = new WebAssembly.Instance(wasm, info)
        //     receive(instance)
        //     return instance.exports
        // },

    });

    await new Promise<void>(resolve => {
        socket = new WS2S('ws://localhost:3613/').newSocket();
        socket.onReady = () => {
            console.info('socket: ready');
            socket.connect(host, port);
        }
        socket.onOpen = () => {
            console.info('socket: connected');
            resolve();
        }
        socket.onRecv = (data) => {
            console.info(`socket: ${data.length} bytes received:${toFriendlyHex(data.subarray(0, 16))}${data.length > 16 ? ' …' : ''}`);
            incomingDataQueue.push(data);
            dequeueIncomingData();
        }
        socket.onClose = () => {
            console.info('socket: disconnected');
            if (emResolve) emResolve(0);
        }
    });

    const initTls = module.cwrap('initTls', 'number', ['string', 'array', 'number']);  // host, entropy, entropy length

    return {
        startTls() {
            const entropyLen = 128;
            const entropy = new Uint8Array(entropyLen);
            crypto.getRandomValues(entropy);
            initTls(host, entropy, entropyLen);
        },
        writeData: module.cwrap('writeData', 'number', ['array', 'number'], { async: true }) as (data: Uint8Array, length: number) => Promise<number>,
        readData: module.cwrap('readData', 'number', ['number', 'number'], { async: true }) as (pointer: number, length: number) => Promise<number>,
        malloc: module._malloc as (bytes: number) => number,
        free: module._free as () => void,
        getValue: module.getValue as (pointer: number, type: string) => number,
        setValue: module.setValue as (pointer: number, value: number, type: string) => number,
    };
});
