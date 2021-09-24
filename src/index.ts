
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

    writeu64(v:Array<number>) {
        this.writeu32(v[1])
        this.writeu32(v[0])
    }

}

const NTFS_EPOCH = new Date("01-Jan-1601 00:00:00 UTC");
const BYTES_PER_RECORD = 46 + 36; // 36 for extra NTFS timestamp field

class SimpleZip {

    private buf : SimpleBuffer;
    private files : Array<ZipEntry> = [];
    private createdTime : number;
    private createdDate : number;
    private ntfsTimeSinceEpoch : Array<number> = [];
    private static crcTable : Array<number>|null = null;

    // How much space at the end for the CentralDiRectory is required
    private cdrAccumulate : number = 0;

    constructor(expectedMaxSize:number) {
        this.buf = new SimpleBuffer(expectedMaxSize);
        // Compute timestamps
        const now = new Date();
        let hour = now.getHours();
        let minute = now.getMinutes();
        let second = Math.floor(now.getSeconds() / 2);
        let year = now.getFullYear() - 1980;
        let month = now.getMonth() + 1;
        let day = now.getDate()

        // https://www.mindprod.com/jgloss/zip.html
        this.createdTime = ((hour & 0x1F) << 11) | ((minute & 0x3F) << 5) | (second & 0x1F);
        this.createdDate = ((year & 0x7F) << 9) | ((month & 0xF) << 5) | (day & 0x1F);
        // https://opensource.apple.com/source/zip/zip-6/unzip/unzip/proginfo/extra.fld
        // NTFS timestap is 10ths of useconds since epoch 01-Jan-1601
        // (2^32/1e-7) = every 429.4967296 seconds, the 'upper' 32-bits should increase by 1
        let ntfsMilliseconds = (now.getTime() - NTFS_EPOCH.getTime());
        // Precision of 1.0E-07 seconds, ms is 1.0E-03, so we must scale by 1.0E+04
        // Max safe int in JS is 2^53, that's only 21 upper bits
        // 429 * 2^21 / 3600 / 24 / 365 = ~ can only represent 28.6 years after epoch with JS integer
        // need to carefully handle the separation of the time into two 32-bit integers
        // This seems to work well
        let upper = Math.floor(ntfsMilliseconds / 429496.7296); // =/1000/429.4967296
        // Truncate upper bits before multiplying to ensure we stay within the realm of an int
        let lower = ((ntfsMilliseconds & 0xFFFFFFFF) * 10000) & 0xFFFFFFFF;
        this.ntfsTimeSinceEpoch.push(upper);
        this.ntfsTimeSinceEpoch.push(lower);
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
            this.buf.writeu16(this.createdTime); //Last mod Time
            this.buf.writeu16(this.createdDate); //Last mod Date
            this.buf.writeu32(zEntry.crc); //CRC32
            this.buf.writeu32(zEntry.size); //Compressed Size
            this.buf.writeu32(zEntry.size); //Uncompressed Size
            this.buf.writeu16(zEntry.name.length); //Filename Length
            this.buf.writeu16(0); //Extra Field Length
            this.buf.writeStr(zEntry.name); // Name
            // no extra field
            this.buf.append(data); // Uncompressed Data
    
            this.files.push(zEntry);
        }
    }

    generate() {
        let centralDirStart = this.buf.getIndex();

        let requiredRemaining = 22;

        for(let file of this.files) {
            requiredRemaining += BYTES_PER_RECORD + file.name.length;
        }
        
        this.buf.ensureRemaining(requiredRemaining);

        // Write central directory file headers
        for (let file of this.files) {
            this.buf.writeu32(0x02014b50); //Header sig
            this.buf.writeu16(0x003f); //Version made by Windows
            this.buf.writeu16(0x000a); //Version needed
            this.buf.writeu16(0x0000); //Bit Flag
            this.buf.writeu16(0x0000); //Compression Method(none)
            this.buf.writeu16(this.createdTime); //Last mod Time
            this.buf.writeu16(this.createdDate); //Last mod Date
            this.buf.writeu32(file.crc); //CRC32
            this.buf.writeu32(file.size); //Compressed Size
            this.buf.writeu32(file.size); //Uncompressed Size
            this.buf.writeu16(file.name.length); //Filename Length
            this.buf.writeu16(0x0024); //Extra Field Length
            this.buf.writeu16(0x0000); //File Comment Length
            this.buf.writeu16(0x0000); //Disk no.
            this.buf.writeu16(0x0000); //Internal Attributes
            this.buf.writeu32(0x00000020); //External Attributes
            this.buf.writeu32(file.offset); //Relative Offset
            this.buf.writeStr(file.name); //File Name
            // Write more accurate timestamp, using NTFS extra field
            this.buf.writeu16(0x000a) // NTFS timestamp
            this.buf.writeu16(0x0020) // 32 bytes of data
            this.buf.writeu32(0x00000000) // reserved
            this.buf.writeu16(0x0001) // Tag for attribute #1
            this.buf.writeu16(0x0018) // Size of attribute 1 (24 bytes)
            this.buf.writeu64(this.ntfsTimeSinceEpoch) // last modified
            this.buf.writeu64(this.ntfsTimeSinceEpoch) // last accessed
            this.buf.writeu64(this.ntfsTimeSinceEpoch) // last created
            // No comment
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
            requiredSize += file.name.length*2 + BYTES_PER_RECORD + 30;
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