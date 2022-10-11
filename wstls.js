import { bearssl_emscripten } from './bearssl.js';
export default (async function (host, port) {
    let module;
    let socket;
    const incomingDataQueue = [];
    let emBuf = null;
    let emMaxSize = 0;
    let emResolve = null;
    function dequeueIncomingData() {
        if (incomingDataQueue.length === 0 || emResolve === null || emBuf === null)
            return;
        let nextData = incomingDataQueue[0];
        if (nextData.length > emMaxSize) {
            incomingDataQueue[0] = nextData.subarray(emMaxSize);
            nextData = nextData.subarray(0, emMaxSize);
        }
        else {
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
            socket.send(arr);
            return size;
        },
        /* for Cloudflare workers we'd use something like: */
        // instantiateWasm(info, receive) {
        //     let instance = new WebAssembly.Instance(wasm, info)
        //     receive(instance)
        //     return instance.exports
        // },
    });
    await new Promise((resolve, reject) => {
        socket = new WebSocket(`ws://localhost:9090/?name=${host}:${port}`);
        socket.binaryType = 'arraybuffer';
        socket.addEventListener('open', () => {
            resolve();
        });
        socket.addEventListener('error', err => {
            reject(err);
        });
        socket.addEventListener('close', () => {
            console.info('socket: disconnected');
            if (emResolve)
                emResolve(0);
        });
        socket.addEventListener('message', (msg) => {
            const data = new Uint8Array(msg.data);
            console.info(`socket: ${data.length} bytes received`);
            incomingDataQueue.push(data);
            dequeueIncomingData();
        });
    });
    const wasm = {
        initTls: module.cwrap('initTls', 'number', ['string', 'array', 'number']),
        writeData: module.cwrap('writeData', 'number', ['array', 'number'], { async: true }),
        readData: module.cwrap('readData', 'number', ['number', 'number'], { async: true }),
    };
    return {
        startTls() {
            const entropyLen = 128;
            const entropy = new Uint8Array(entropyLen);
            crypto.getRandomValues(entropy);
            return wasm.initTls(host, entropy, entropyLen);
        },
        async writeData(data) {
            const status = await wasm.writeData(data, data.length);
            return status;
        },
        async readData(maxBytes = 16709) {
            const buf = module._malloc(maxBytes);
            try {
                const bytesRead = await wasm.readData(buf, maxBytes);
                if (bytesRead <= 0)
                    return null;
                return module.HEAPU8.slice(buf, buf + bytesRead);
            }
            finally {
                module._free(buf);
            }
        },
    };
});
