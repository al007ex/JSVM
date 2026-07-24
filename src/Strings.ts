import { Op } from "./Op";
import { forEveryParser, Scope } from "./Parserv2";
import { i32Bytes } from "./Utils";

export class Strings {
    public id = 0;
    public strings: Array<string> = [];
    public set: {[key: string]: number} = {};
    public parent: Scope;

    constructor(parent: Scope){
        this.parent = parent;
    }

    add(string: string){
        if(string.length > 0xffffffff) throw("Cant support strings over 0xffffffff length yet");
        //wtf javascript
        if(string === "__proto__") string = "____proto____";
       
        if(!Object.hasOwnProperty.apply(this.set, [string])){
            let id = this.id++;
            this.set[string] = id;
            this.strings[id] = string;
        }
    }

    get(string: string): number{
        //wtf javascript
        if(string === "__proto__") string = "____proto____";
        if(!Object.hasOwnProperty.apply(this.set, [string])) this.add(string);
        return this.set[string];
    }

    getData(): {
        stringScope: Array<any>,
        rawStringdata: Uint8Array,
    }{
        let offset = 0;
        forEveryParser(this.parent, (scope) => {
            offset += scope.offset;
        });
        let stringScope = [0, -1, 0, [], offset];
        let buffer = [];
        this.strings.forEach(str => {
            buffer.push(Op.RegisterString);

            let strLength = str.length;
            if(strLength >= 0xff){
                buffer.push(0xff);
                let bytes = i32Bytes(strLength);
                bytes.forEach(byte => buffer.push(byte));
            }else{
                buffer.push(strLength);
            }

            for(let i = 0 ; i < str.length; i++) buffer.push(str.charCodeAt(i));
        })
        
        buffer.push(Op.JumpToBlock);
        buffer.push(1); //jump to 0
        buffer.push(0);
        buffer.push(0);
        buffer.push(0);
        buffer.push(Op.END);

        let rawStringdata = new Uint8Array(buffer);
        return {
            stringScope,
            rawStringdata,
        }
    }
}
