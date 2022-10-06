
const
  host = 'neon.tech',
  port = 443;

function toFriendlyHex(binStrOrArr) {
  let s = '';
  if (typeof binStrOrArr === 'string') {
    for (let i = 0, len = binStrOrArr.length; i < len; i++) {
      let hex = binStrOrArr.charCodeAt(i).toString(16);
      s += (hex.length < 2 ? '0' : '') + hex + ' ';
    }
  } else {
    for (let i = 0, len = binStrOrArr.length; i < len; i++) {
      let hex = binStrOrArr[i].toString(16);
      s += (hex.length < 2 ? '0' : '') + hex + ' ';
    }
  }
  return s;
}

function byteArrayFromPointer(buff, size) {
  const arr = new Uint8Array(size);
  for (let i = 0; i < size; i++) arr[i] = Module.getValue(buff + i, 'i8');
  return arr;
}

Module.onRuntimeInitialized = function () {
  const initTls = Module.cwrap('initTls', 'number', ['string', 'array', 'number']);
  const writeData = Module.cwrap('writeData', 'number', ['array', 'number'], { async: true });
  const readData = Module.cwrap('readData', 'number', ['number', 'number'], { async: true });

  const socket = new WS2S('ws://localhost:3613/').newSocket();

  const incomingDataQueue = [];

  let globalBuf = null;
  let globalMaxSize = 0;
  let globalResolve = null;

  function dequeueIncomingData() {
    if (incomingDataQueue.length === 0 || globalResolve === null) return;

    let nextData = incomingDataQueue[0];
    if (nextData.length > globalMaxSize) {
      incomingDataQueue[0] = nextData.subarray(globalMaxSize);
      nextData = nextData.subarray(0, globalMaxSize);

    } else {
      incomingDataQueue.shift();
    }

    console.log('setting buffer data');
    const len = nextData.length;
    for (let i = 0; i < len; i++) Module.setValue(globalBuf + i, nextData[i], 'i8');

    const resolve = globalResolve;
    globalResolve = globalBuf = null;
    globalMaxSize = 0;

    console.log('returning control');
    resolve(len);
  }

  Module.provideEncryptedFromNetwork = (buf, maxSize) => {
    console.log(`providing up to ${maxSize} encrypted bytes from network`);

    globalBuf = buf;
    globalMaxSize = maxSize;
    const promise = new Promise(resolve => globalResolve = resolve);

    dequeueIncomingData();
    return promise;
  }

  Module.receiveDecryptedFromLibrary = (buf, size) => {
    console.log(`receiving ${size} decrypted bytes from library`);

    console.log(buf);
  }

  Module.writeEncryptedToNetwork = (buf, size) => {
    console.log(`writing ${size} encrypted bytes to network`);

    const arr = byteArrayFromPointer(buf, size);
    socket.sendb(arr);
    return size;
  }

  socket.onReady = () => {
    socket.connect(host, port);
  }

  socket.onOpen = async () => {
    // console.log('[socket] connected: sending pg probe value');
    // var pgMagic = arrFromFriendlyHex('00 00 00 08 04 D2 16 2F');
    // socket.sendb(pgMagic);

    const entropyLen = 256;
    const entropy = new Uint8Array(entropyLen);
    crypto.getRandomValues(entropy);

    let result = initTls(host, entropy, entropyLen);
    console.log(result);

    const getReq = `GET / HTTP/1.0\r\nHost: ${host}\r\n\r\n`;
    const len = getReq.length;
    const arr = new Uint8Array(len);
    for (let i = 0; i < len; i ++) arr[i] = getReq.charCodeAt(i);
    console.log(getReq);
    result = await writeData(arr, len);
    console.log('write result', result);

    const size = 1024;
    const buf = Module._malloc(size);
    for (;;) {
      result = await readData(buf, size);
      if (result <= 0) break;
      let str = '';
      for (let i = 0; i < result; i ++) str += String.fromCharCode(getValue(buf + i, 'i8'));
      console.log('decrypted', str);
    }
  };

  // var receivedS = false;

  socket.onRecv = (data) => {
    console.log(`raw data received (${data.length} bytes):`, toFriendlyHex(data));

    incomingDataQueue.push(data);
    dequeueIncomingData();

    // var binStr = binStrFromArr(data);
    // if (receivedS === false && binStr === 'S') {
    //   receivedS = true;
    //   client.handshake();
    //   //socket.sendb(arrFromFriendlyHex('16 03 01 00 6a 01 00 00 66 03 03 7a 88 bd db 11 34 5e 2a d4 25 01 fa 9d e5 52 56 2c c8 d0 e1 23 0f cc 4b fb a5 a0 c8 a2 72 b6 2c 00 00 04 00 3d 00 3c 01 00 00 39 00 00 00 2b 00 29 00 00 26 70 61 74 69 65 6e 74 2d 74 68 75 6e 64 65 72 2d 31 38 37 34 33 35 2e 63 6c 6f 75 64 2e 6e 65 6f 6e 2e 74 65 63 68 00 0d 00 06 00 04 04 01 02 01'));
    //   //socket.sendb(arrFromFriendlyHex('16 03 01 00 ec 01 00 00 e8 03 03 76 01 f0 fe fd 88 2e 0b 44 39 f6 2e fe d5 28 3d be 40 1d 6d 0a de e6 26 d7 31 4c ca 78 19 67 d3 00 00 38 c0 2c c0 30 00 9f cc a9 cc a8 cc aa c0 2b c0 2f 00 9e c0 24 c0 28 00 6b c0 23 c0 27 00 67 c0 0a c0 14 00 39 c0 09 c0 13 00 33 00 9d 00 9c 00 3d 00 3c 00 35 00 2f 00 ff 01 00 00 87 00 00 00 2b 00 29 00 00 26 70 61 74 69 65 6e 74 2d 74 68 75 6e 64 65 72 2d 31 38 37 34 33 35 2e 63 6c 6f 75 64 2e 6e 65 6f 6e 2e 74 65 63 68 00 0b 00 04 03 00 01 02 00 0a 00 0c 00 0a 00 1d 00 17 00 1e 00 19 00 18 00 23 00 00 00 16 00 00 00 17 00 00 00 0d 00 30 00 2e 04 03 05 03 06 03 08 07 08 08 08 09 08 0a 08 0b 08 04 08 05 08 06 04 01 05 01 06 01 03 03 02 03 03 01 02 01 03 02 02 02 04 02 05 02 06 02'));

    // } else {
    //   client.process(binStr);
    // }
  }

  socket.onClose = () => {
    console.log('[socket] disconnected');
    if (globalResolve) globalResolve(0);
  }

}
