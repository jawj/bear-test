
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

function byteArrayFromPointer(buff, size) {
  const arr = new Uint8Array(size);
  for (let i = 0; i < size; i++) arr[i] = Module.getValue(buff + i, 'i8');
  return arr;
}

Module.onRuntimeInitialized = function () {
  const initTls = Module.cwrap('initTls', 'number', ['string', 'array', 'number']);  // host, entropy, entropy length
  const writeData = Module.cwrap('writeData', 'number', ['array', 'number'], { async: true });  // data (array), length
  const readData = Module.cwrap('readData', 'number', ['number', 'number'], { async: true });  // buffer (pointer), length

  const socket = new WS2S('ws://localhost:3613/').newSocket();

  const incomingDataQueue = [];  // array of Uint8Arrays
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
    const 
      entropyLen = 192,
      entropy = new Uint8Array(entropyLen);

    crypto.getRandomValues(entropy);

    let result = initTls(host, entropy, entropyLen);
    console.log('initTls result:', result);

    const getReq = `GET / HTTP/1.0\r\nHost: ${host}\r\n\r\n`;
    const len = getReq.length;
    const arr = new Uint8Array(len);
    for (let i = 0; i < len; i ++) arr[i] = getReq.charCodeAt(i);
    console.log(getReq);

    result = await writeData(arr, len);
    console.log('write result:', result);

    const size = 17000;
    const buf = Module._malloc(size);
    let page = '';
    for (;;) {
      result = await readData(buf, size);
      if (result <= 0) break;
      let str = '';
      for (let i = 0; i < result; i ++) str += String.fromCharCode(getValue(buf + i, 'i8'));
      console.log('>>', str);
      page += str;
    }

    document.body.style.margin = 0;
    document.body.style.padding = 0;

    const headersEnd = page.indexOf('\r\n\r\n');
    
    const headers = page.slice(0, headersEnd);
    const pre = document.createElement('pre');
    pre.innerText = headers;
    pre.style.width = '100vw';
    pre.style.height = '30vh';
    pre.style.overflow = 'scroll'
    document.body.appendChild(pre);

    const html = page.slice(headersEnd);
    const iframe = document.createElement('iframe');
    iframe.srcdoc = html;
    iframe.style.width = '100vw';
    iframe.style.height = '65vh';
    document.body.appendChild(iframe);

    Module._free(buf);
    console.log('finished');
  };

  // var receivedS = false;

  socket.onRecv = (data) => {
    console.info(`socket.onRecv / ${data.length} bytes received:`, toFriendlyHex(data));

    incomingDataQueue.push(data);
    dequeueIncomingData();
  }

  socket.onClose = () => {
    console.info('socket.onClose / disconnected');
    if (globalResolve) globalResolve(0);
  }

}
