import WsTls from './wstls.js';
const [host, portStr] = location.search.slice(1).split(':');
const port = parseInt(portStr, 10) || 443;
export default async function main() {
    const wsTls = await WsTls(host, port);
    wsTls.startTls();
    const getReqBuf = new TextEncoder()
        .encode(`GET / HTTP/1.0\r\nHost: ${host}\r\n\r\n`); // UTF8
    await wsTls.writeData(getReqBuf);
    const te = new TextDecoder(); // UTF8
    while (true) {
        let data = await wsTls.readData();
        if (data === null)
            break;
        const str = te.decode(data);
        console.log(str);
    }
}
