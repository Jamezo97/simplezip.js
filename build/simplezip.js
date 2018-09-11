(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.SimpleZip = f()}})(function(){var define,module,exports;return (function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
"use strict";
function isNullOrUndefined(obj) {
    return obj === null || obj === undefined;
}
var SimpleBuffer = /** @class */ (function () {
    function SimpleBuffer(initialSize) {
        this.array = new Uint8Array(initialSize);
        this.index = 0;
    }
    SimpleBuffer.prototype.ensureRemaining = function (size) {
        var newCapacity = this.index + size;
        if (newCapacity > this.array.byteLength) {
            console.log("Reallocate Zip From", this.array.byteLength, "to", newCapacity);
            var newBuf = new Uint8Array(newCapacity);
            newBuf.set(this.array.slice(0, this.index), 0);
            delete this.array;
            this.array = newBuf;
        }
    };
    SimpleBuffer.prototype.getArrayBuffer = function () {
        return this.array.buffer.slice(0, this.index);
    };
    SimpleBuffer.prototype.getCapacity = function () {
        return this.array.byteLength;
    };
    SimpleBuffer.prototype.getIndex = function () {
        return this.index;
    };
    SimpleBuffer.prototype.writeStr = function (v) {
        for (var i = 0; i < v.length; i++) {
            this.array[this.index++] = v.charCodeAt(i) & 0xFF;
        }
    };
    ;
    SimpleBuffer.prototype.append = function (v) {
        this.array.set(v, this.index);
        this.index += v.length;
    };
    SimpleBuffer.prototype.writeu8 = function (v) {
        this.array[this.index++] = v & 0xFF;
    };
    SimpleBuffer.prototype.writeu16 = function (v) {
        this.array[this.index++] = v & 0xFF;
        this.array[this.index++] = (v >> 8) & 0xFF;
    };
    SimpleBuffer.prototype.writeu32 = function (v) {
        this.array[this.index++] = v & 0xFF;
        this.array[this.index++] = (v >> 8) & 0xFF;
        this.array[this.index++] = (v >> 16) & 0xFF;
        this.array[this.index++] = (v >> 24) & 0xFF;
    };
    return SimpleBuffer;
}());
var SimpleZip = /** @class */ (function () {
    function SimpleZip(expectedMaxSize) {
        this.files = [];
        // How much space at the end for the CentralDiRectory is required
        this.cdrAccumulate = 0;
        this.buf = new SimpleBuffer(expectedMaxSize);
    }
    SimpleZip.prototype.ensureRemainingSpace = function (remaining) {
        this.buf.ensureRemaining(remaining);
    };
    SimpleZip.prototype.appendFile = function (file) {
        this.appendFiles([file]);
    };
    SimpleZip.prototype.appendFiles = function (files) {
        var zips = [];
        var headerAccumulate = 0;
        // Parse all the files, work out how much space is required to store them
        for (var _i = 0, files_1 = files; _i < files_1.length; _i++) {
            var file = files_1[_i];
            if (isNullOrUndefined(file) || isNullOrUndefined(file.name) || isNullOrUndefined(file.data)) {
                throw new Error("Zip file entry missing 'name' or 'data' props");
            }
            if (typeof file.name !== 'string' || file.name.length <= 0) {
                throw new Error("File name must be a string with >0 characters");
            }
            var data = void 0;
            if (typeof file.data === 'string') {
                data = new Uint8Array(file.data.length);
                for (var i = 0; i < file.data.length; i++) {
                    data[i] = file.data.charCodeAt(i);
                }
            }
            else if (file.data instanceof Uint8Array) {
                data = file.data;
            }
            else if (file.data instanceof ArrayBuffer) {
                data = new Uint8Array(file.data);
            }
            else {
                throw new Error("Unknown typeof data: " + typeof file.data);
            }
            var zEntry = {
                name: file.name,
                size: data.byteLength,
                crc: SimpleZip.calcCRC32(data),
                offset: -1
            };
            zips.push({
                zEntry: zEntry,
                data: data
            });
            headerAccumulate += 30 + zEntry.name.length + data.byteLength;
            this.cdrAccumulate += 46 + file.name.length;
        }
        // +22 for EOCD
        this.buf.ensureRemaining(headerAccumulate + this.cdrAccumulate + 22);
        for (var _a = 0, zips_1 = zips; _a < zips_1.length; _a++) {
            var entry = zips_1[_a];
            var zEntry = entry.zEntry;
            var data = entry.data;
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
    };
    SimpleZip.prototype.generate = function () {
        var centralDirStart = this.buf.getIndex();
        var requiredRemaining = 22;
        for (var _i = 0, _a = this.files; _i < _a.length; _i++) {
            var file = _a[_i];
            requiredRemaining += 46 + file.name.length;
        }
        this.buf.ensureRemaining(requiredRemaining);
        // Write central directory file headers
        for (var _b = 0, _c = this.files; _b < _c.length; _b++) {
            var file = _c[_b];
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
        var centralDirEnd = this.buf.getIndex();
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
    };
    SimpleZip.GenerateZipFrom = function (files) {
        var requiredSize = 22; //EOCD
        for (var _i = 0, files_2 = files; _i < files_2.length; _i++) {
            var file = files_2[_i];
            // 1xData, 2xName, 1xCentral Directory File Header and 1xLocal File Header
            if (typeof file.data === "string") {
                requiredSize += file.data.length;
            }
            else {
                requiredSize += file.data.byteLength;
            }
            requiredSize += file.name.length * 2 + 46 + 30;
        }
        var zip = new SimpleZip(requiredSize);
        zip.appendFiles(files);
        return zip.generate();
    };
    SimpleZip.calcCRC32 = function (data) {
        SimpleZip.genCRCTable();
        if (SimpleZip.crcTable !== null) {
            var crc = 0 ^ (-1);
            for (var i = 0; i < data.length; i++) {
                crc = (crc >>> 8) ^ SimpleZip.crcTable[(crc ^ data[i]) & 0xFF];
            }
            return (crc ^ (-1)) >>> 0;
        }
        return -1;
    };
    SimpleZip.genCRCTable = function () {
        if (SimpleZip.crcTable === null) {
            SimpleZip.crcTable = Array(256);
            var c = void 0;
            for (var n = 0; n < 256; n++) {
                c = n;
                for (var k = 0; k < 8; k++) {
                    c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
                }
                SimpleZip.crcTable[n] = c;
            }
        }
    };
    SimpleZip.crcTable = null;
    return SimpleZip;
}());
module.exports = SimpleZip;

},{}]},{},[1])(1)
});
