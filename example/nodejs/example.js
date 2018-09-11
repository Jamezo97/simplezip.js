const SimpleZip = require("../../lib/index");
const fs = require("fs");

let files = [{
    name: "FirstFile.txt",
    data: "The contents"
}, {
    name: "SecondFile.txt",
    data: Buffer.from("Also, the contents",'utf8')
}];

// This returns an ArrayBuffer
let data = SimpleZip.GenerateZipFrom(files);

fs.writeFileSync("output.zip", new Buffer(data), {encoding: 'binary'});