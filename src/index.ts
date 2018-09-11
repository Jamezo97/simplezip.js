
type ZipFile = {name:string,data:ArrayBuffer|Uint8Array|string};
type ZipEntry = {name:string,size:number,crc:number,offset:number};

function isNullOrUndefined(obj:any) {
    return obj === null || obj === undefined;
}

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
            console.log("Reallocate Zip From", this.array.byteLength,"to",newCapacity);
            let newBuf = new Uint8Array(newCapacity);
            newBuf.set(this.array.slice(0, this.index), 0);
            delete this.array;
            this.array = newBuf;
        }
    }

    getArrayBuffer() {
        if(this.array.buffer.byteLength === this.index) {
            return this.array.buffer;
        }
        // Not ideal but necessary. How to slice without copying the data? I don't know... 
        //      Not without NodeJS buffers
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

    // How much space at the end for the CentralDiRectory is required
    private cdrAccumulate : number = 0;

    constructor(expectedMaxSize:number) {
        this.buf = new SimpleBuffer(expectedMaxSize);
    }

    ensureRemainingSpace(remaining:number) {
        this.buf.ensureRemaining(remaining);
    }

    appendFile(file:ZipFile) {
        this.appendFiles([file]);
    }

    appendFiles(files:Array<ZipFile>) {
        let zips:Array<{zEntry:ZipEntry,data:Uint8Array}> = [];
        let headerAccumulate = 0;

        // Parse all the files, work out how much space is required to store them
        for(let file of files) {
            if(isNullOrUndefined(file) || isNullOrUndefined(file.name) || isNullOrUndefined(file.data)) {
                throw new Error("Zip file entry missing 'name' or 'data' props");
            }
            if(typeof file.name !== 'string' || file.name.length <= 0) {
                throw new Error("File name must be a string with >0 characters");
            }
    
            let data : Uint8Array;
            if(typeof file.data === 'string') {
                data = new Uint8Array(file.data.length);
                for(let i = 0; i < file.data.length; i++) {
                    data[i] = file.data.charCodeAt(i);
                }
            } else if(file.data instanceof Uint8Array) {
                data = file.data;
            } else if(file.data instanceof ArrayBuffer) {
                data = new Uint8Array(file.data);
            } else {
                throw new Error("Unknown typeof data: " + typeof file.data);
            }
            
            let zEntry:ZipEntry = {
                name: file.name,
                size: data.byteLength,
                crc: SimpleZip.calcCRC32(data),
                offset: -1
            };

            zips.push({
                zEntry: zEntry,
                data: data
            });
            headerAccumulate += 30+zEntry.name.length+data.byteLength;
            this.cdrAccumulate += 46 + file.name.length;
        }
        // +22 for EOCD
        this.buf.ensureRemaining(headerAccumulate + this.cdrAccumulate + 22);

        for(let entry of zips) {
            let zEntry = entry.zEntry;
            let data = entry.data;
            
            zEntry.offset = this.buf.getIndex();

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
    }

    generate() {
        let centralDirStart = this.buf.getIndex();

        let requiredRemaining = 22;

        for(let file of this.files) {
            requiredRemaining += 46 + file.name.length;
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
            if(typeof file.data === "string") {
                requiredSize += file.data.length;
            } else {
                requiredSize += file.data.byteLength;
            }
            requiredSize += file.name.length*2 + 46 + 30;
        }
        let zip = new SimpleZip(requiredSize);
        zip.appendFiles(files);
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
export = SimpleZip;