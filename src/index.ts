
type ZipFile = {name:string,data:ArrayBuffer};
type ZipEntry = {name:string,size:number,crc:number,offset:number};

class SimpleBuffer {
    
    private array : Uint8Array;
    private index : number;

    constructor(initialSize:number) {
        this.array = new Uint8Array(initialSize);
        this.index = 0;
    }

    ensureRemaining(size:number) {
        let newCapacity = this.index+size;
        if(newCapacity > this.array.byteLength) {
            let newBuf = new Uint8Array(newCapacity);
            newBuf.set(this.array.slice(0, this.index), 0);
            this.array = newBuf;
            delete this.array;
        }
    }

    getArrayBuffer() {
        return this.array.buffer.slice(0, this.index);    
    }

    getCapacity() {
        return this.array.byteLength;
    }

    getIndex() {
        return this.index;
    }

    writeStr(v:string) {
        for(var i = 0; i < v.length; i++){
            this.array[this.index++] = v.charCodeAt(i) & 0xFF;
        }
    };

    append(v:Uint8Array) {
        this.array.set(v, this.index);
        this.index += v.length;
    }
        
    writeu8(v:number) {
        this.array[this.index++] = v&0xFF;
    }

    writeu16(v:number) {
        this.array[this.index++] = v&0xFF;
        this.array[this.index++] = (v>>8)&0xFF;
    }

    writeu32(v:number) {
        this.array[this.index++] = v&0xFF;
        this.array[this.index++] = (v>>8)&0xFF;
        this.array[this.index++] = (v>>16)&0xFF;
        this.array[this.index++] = (v>>24)&0xFF;
    }

}

class SimpleZip {

    private buf : SimpleBuffer;
    private files : Array<ZipEntry> = [];
    private static crcTable : Array<number>|null = null;

    constructor(expectedMaxSize:number) {
        this.buf = new SimpleBuffer(expectedMaxSize);
    }

    appendFile(file:ZipFile) {
        let data = new Uint8Array(file.data);
        let zEntry:ZipEntry = {
            name: file.name,
            size: data.byteLength,
            crc: SimpleZip.calcCRC32(data),
            offset: this.buf.getIndex()
        };
        
        this.buf.ensureRemaining(30+zEntry.name.length+data.byteLength);

        this.buf.writeu32(0x04034b50); //Header sig
        this.buf.writeu16(0x000a); //Version
        this.buf.writeu16(0x0000); //Bit Flag
        this.buf.writeu16(0x0000); //Compression Method(none)
        this.buf.writeu16(0x94f8); //Last mod Time
        this.buf.writeu16(0x4d24); //Last mod Date
        this.buf.writeu32(zEntry.crc); //CRC32
        this.buf.writeu32(zEntry.size); //Compressed Size
        this.buf.writeu32(zEntry.size); //Uncompressed Size
        this.buf.writeu16(zEntry.name.length); //Filename Length
        this.buf.writeu16(0); //Extra Field Length
        this.buf.writeStr(zEntry.name); // Name
        this.buf.append(data); // Uncompressed Data

        this.files.push(zEntry);
    }

    generate() {
        let centralDirStart = this.buf.getIndex();

        let requiredRemaining = 22;

        for(let file of this.files) {
            requiredRemaining += 46 + file.name.length
        }
        
        this.buf.ensureRemaining(requiredRemaining);

        // Write central directory file headers
        for (let file of this.files) {
            this.buf.writeu32(0x02014b50); //Header sig
            this.buf.writeu16(0x033f); //Version made by
            this.buf.writeu16(0x000a); //Version needed
            this.buf.writeu16(0x0000); //Bit Flag
            this.buf.writeu16(0x0000); //Compression Method(none)
            this.buf.writeu16(0x94f8); //Last mod Time
            this.buf.writeu16(0x4d24); //Last mod Date
            this.buf.writeu32(file.crc); //CRC32
            this.buf.writeu32(file.size); //Compressed Size
            this.buf.writeu32(file.size); //Uncompressed Size
            this.buf.writeu16(file.name.length); //Filename Length
            this.buf.writeu16(0x000); //Extra Field Length
            this.buf.writeu16(0x000); //File Comment Length
            this.buf.writeu16(0x0000); //Disk no.
            this.buf.writeu16(0x0000); //Internal Attributes
            this.buf.writeu32(0x00000002); //External Attributes
            this.buf.writeu32(file.offset); //Relative Offset
            this.buf.writeStr(file.name); //File Name
            // No extra field
            // No commend
        }
        let centralDirEnd = this.buf.getIndex();

        // Write EOCD (22 Bytes)

        this.buf.writeu32(0x06054b50); //Header sig
        this.buf.writeu16(0x0000); //Header sig
        this.buf.writeu16(0x0000); //Header sig
        this.buf.writeu16(this.files.length); //Header sig
        this.buf.writeu16(this.files.length); //Header sig
        this.buf.writeu32(centralDirEnd - centralDirStart);
        this.buf.writeu32(centralDirStart);
        this.buf.writeu16(0x00);

        return this.buf.getArrayBuffer();
    }

    public static GenerateZipFrom(files:Array<ZipFile>) {
        let requiredSize = 22; //EOCD
        for(let file of files) {
            // 1xData, 2xName, 1xCentral Directory File Header and 1xLocal File Header
            requiredSize += file.data.byteLength + file.name.length*2 + 46 + 30;
        }
        let zip = new SimpleZip(requiredSize);
        for(let file of files) {
            zip.appendFile(file);
        }
        return zip.generate();
    }

    private static calcCRC32(data:Uint8Array) {
        SimpleZip.genCRCTable();
        if(SimpleZip.crcTable !== null) {
            let crc = 0 ^ (-1);
            for (let i = 0; i < data.length; i++ ) {
                crc = (crc >>> 8) ^ SimpleZip.crcTable[(crc ^ data[i]) & 0xFF];
            }
            return (crc ^ (-1)) >>> 0;
        }
        return -1;
    }

    private static genCRCTable() {
        if(SimpleZip.crcTable === null) {
            SimpleZip.crcTable = Array(256);
            let c;
            for(let n = 0; n < 256; n++){
                c = n;
                for(var k =0; k < 8; k++){
                    c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
                }
                SimpleZip.crcTable[n] = c;
            }
        }
    }
}

export {SimpleZip};