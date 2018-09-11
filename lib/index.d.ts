declare type ZipFile = {
    name: string;
    data: ArrayBuffer | Uint8Array | string;
};
declare class SimpleZip {
    private buf;
    private files;
    private static crcTable;
    private cdrAccumulate;
    constructor(expectedMaxSize: number);
    ensureRemainingSpace(remaining: number): void;
    appendFile(file: ZipFile): void;
    appendFiles(files: Array<ZipFile>): void;
    generate(): ArrayBuffer;
    static GenerateZipFrom(files: Array<ZipFile>): ArrayBuffer;
    private static calcCRC32;
    private static genCRCTable;
}
export = SimpleZip;
