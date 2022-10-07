
const [host, portStr] = location.search.slice(1).split(':');
const port = parseInt(portStr, 10) || 443;

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

function arrFromFriendlyHex(hex) {
  return hex.split(' ').map(pair => parseInt(pair, 16));
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

    const len = nextData.length;
    for (let i = 0; i < len; i++) Module.setValue(globalBuf + i, nextData[i], 'i8');

    const resolve = globalResolve;
    globalResolve = globalBuf = null;
    globalMaxSize = 0;

    resolve(len);
  }

  Module.provideEncryptedFromNetwork = (buf, maxSize) => {
    console.info(`Module.provideEncryptedFromNetwork / providing up to ${maxSize} bytes`);

    globalBuf = buf;
    globalMaxSize = maxSize;
    const promise = new Promise(resolve => globalResolve = resolve);

    dequeueIncomingData();
    return promise;
  }

  Module.writeEncryptedToNetwork = (buf, size) => {
    console.info(`Module.writeEncryptedToNetwork / writing ${size} bytes`);

    const arr = byteArrayFromPointer(buf, size);
    socket.sendb(arr);
    return size;
  }

  socket.onReady = () => {
    socket.connect(host, port);
  }

  socket.onOpen = async () => {
    console.log('connected: sending pg probe value');
    var pgMagic = arrFromFriendlyHex('00 00 00 08 04 D2 16 2F');
    socket.sendb(pgMagic);
  };

  var receivedS = false;

  socket.onRecv = async (data) => {
    if (receivedS === false && data[0] === 'S'.charCodeAt(0)) {
      receivedS = true;
      console.info(`socket.onRecv / ${data.length} bytes received:`, toFriendlyHex(data));

      const entropyLen = 256;
      const entropy = new Uint8Array(entropyLen);
      crypto.getRandomValues(entropy);

      let result = initTls(host, entropy, entropyLen);
      console.log('initTls result:', result);

      await writeData(new Uint8Array([0, 3, 0, 0, 0, 0, 0, 0]), 8); // version 3, zero length

    } else {
      incomingDataQueue.push(data);
      dequeueIncomingData();
    }
  }

  socket.onClose = () => {
    console.info('socket.onClose / disconnected');
    if (globalResolve) globalResolve(0);
  }

}
