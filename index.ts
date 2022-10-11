import WsTls from './wstls.js';

const [host, portStr] = location.search.slice(1).split(':');
const port = parseInt(portStr, 10) || 443;

export default async function main() {
    const wsTls = await WsTls(host, port);
    wsTls.startTls();

    const getReqBuf = new TextEncoder().encode(`GET / HTTP/1.0\r\nHost: ${host}\r\n\r\n`);

    const writeResult = await wsTls.writeData(getReqBuf, getReqBuf.length);
    console.log('write result:', writeResult);

    const size = 17000;
    const buf = wsTls.malloc(size);
    let page = '';
    for (; ;) {
        let readLength = await wsTls.readData(buf, size);
        if (readLength <= 0) break;
        let str = '';
        for (let i = 0; i < readLength; i++) str += String.fromCharCode(wsTls.getValue(buf + i, 'i8'));
        console.log('>>', str);
        page += str;
    }
}