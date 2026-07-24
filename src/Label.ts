import { Scope } from "./Parserv2";
import { i32Bytes, i8Bytes } from "./Utils";

export class Label {
    public reference: Uint8Array;
    public offset = 0;
    public scope: Scope = null;
    public byteLength = 0;
    public destination: number = null;
    public start = 0;

    constructor(scope: Scope, byteLength: number){
        this.scope = scope;
        this.byteLength = byteLength;
    }

    exceedMaxSize(): void{
        throw new Error("Label exceeded maximum size of: " + this.reference.byteLength);
    }

    setOrigin(): void{
        let scope = this.scope;
        this.start = scope.offset;
        this.reference = new Uint8Array(scope._buffer, this.start, this.byteLength);
        scope.offset += this.byteLength;
    }

    setTarget(): void{
        this.destination = this.scope.offset;
    }
    
    writeI8(n: number): void{
        if(this.offset + 1 > this.reference.length) this.exceedMaxSize();
        let i8bytes = i8Bytes(n);
        this.reference[this.offset++] = i8bytes;
    }

    writeI32(n: number): void{
        for(let i = 0 ; i < this.reference.length; i++){
            if(this.reference[i] !== 0) throw("Overwriting");
        }
        if(this.offset + 4 > this.reference.length) this.exceedMaxSize();
        let i32bytes = i32Bytes(n);
        this.reference[this.offset++] = i32bytes[0];
        this.reference[this.offset++] = i32bytes[1];
        this.reference[this.offset++] = i32bytes[2];
        this.reference[this.offset++] = i32bytes[3];
    }
}