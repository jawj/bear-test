
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
            console.info(`socket: ${data.length} bytes received`);
            incomingDataQueue.push(data);
            dequeueIncomingData();
        }
        socket.onClose = () => {
            console.info('socket: disconnected');
            if (emResolve) emResolve(0);
        }
    });

    const wasm = {
        initTls: module.cwrap('initTls', 'number', ['string', 'array', 'number']),  // host, entropy, entropy length
        writeData: module.cwrap('writeData', 'number', ['array', 'number'], { async: true }) as (data: Uint8Array, length: number) => Promise<number>,
        readData: module.cwrap('readData', 'number', ['number', 'number'], { async: true }) as (pointer: number, length: number) => Promise<number>,
    };

    return {
        startTls() {
            const entropyLen = 128;
            const entropy = new Uint8Array(entropyLen);
            crypto.getRandomValues(entropy);
            return wasm.initTls(host, entropy, entropyLen) as number;
        },
        async writeData(data: Uint8Array) {
            const status = await wasm.writeData(data, data.length);
            return status;
        },
        async readData(maxBytes = 16709) {  // BR_SSL_BUFSIZE_INPUT in bearssl_ssl.h
            const buf = module._malloc(maxBytes);
            const bytesRead = await wasm.readData(buf, maxBytes);
            return bytesRead <= 0 ? null : module.HEAPU8.slice(buf, buf + bytesRead) as Uint8Array;
        },
    };
});
