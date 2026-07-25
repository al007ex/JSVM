// @ts-nocheck
import { _Op } from "./Op";

const Op = _Op;

function describeNonCallable(value: any): string {
    if (value === null) {
        return "null";
    }
    if (value === undefined) {
        return "undefined";
    }
    const type = typeof value;
    if (type === "string") {
        return `"${value}"`;
    }
    if (type === "number" || type === "bigint" || type === "boolean") {
        return String(value);
    }
    if (type === "symbol") {
        return value.toString();
    }
    try {
        const label = value.toString();
        if (typeof label === "string" && label !== "[object Object]") {
            return label;
        }
    } catch {
        // ignore to fall through to generic object tag
    }
    return "object";
}

function ensureCallable<T extends Function>(fn: T | any): T {
    if (typeof fn === "function") {
        return fn;
    }
    throw new TypeError(`${describeNonCallable(fn)} is not a function`);
}

export let a = [];
a[Op.CreateFunction] = function(block){
    let blockid = block.readI32();
    //block.log("Binding function to: " + blockid);
    block._stack.push(block.runChild(blockid).makeFn());
}

a[Op.Call] = function(block){
    let totalArgs = block.readI8();
    let args = [];
    let fn = ensureCallable(block._stack.pop());
    for(let i = 0 ; i < totalArgs; i++) args[ totalArgs - i - 1] = block._stack.pop();
    
    let val = __ap.call(fn, globalThis, args); //becareful — __ap is the captured native Function.prototype.apply
    //block.log("Function returned: " + (typeof(val) === "function" ? "function" : val));
    block._stack.push(val);
}

a[Op.ReturnValue] = function(block){
    let value = block._stack.pop();
    //block.log("Returning: " + (typeof(value) === "function" ? "function" : value));
    block.returnRegister = value;
    block.U++;
    
};

a[Op.RegisterString] = function(block){
    block._loadString();
    
}

a[Op.AssignValueToGlobal] = function(block){
    let prop = block._stack.pop();
    let val = block._stack.pop();
    block._stack.push(block.scope[prop] = val);
    //block.log(`MOV ${typeof(val) === "string" || typeof(val) === "number" ? val : typeof(val)} -> global.${prop}`);
    
}
a[Op.GetGlobalVariableValue] = function(block){
    let prop = block._stack.pop();
    //block.log("property", prop);
    testIsGlobalPropOrFunction(prop);
    block._stack.push(globalScope[prop])
    
}
a[Op.GetArguments] = function(block){
    let index = block.readI8();
    //block.log("Loading value into arguments", block.args[index]);
    block._stack.push(block.args[index]);
    
}
a[Op.ObjectPropertyCall] = function(block){
    let totalArgs = block.readI8();
    let args = [];
    let obj = block._stack.pop();
    let prop = block._stack.pop()
    for(let i = 0; i < totalArgs; i++) args[ totalArgs - i - 1 ] = block._stack.pop();
    let fn = ensureCallable(obj[prop]);
    let val = __ap.call(fn, obj, args);
    block._stack.push(val);
    
}
a[Op.String] = function(block){
    let str = block.readString();
    block._stack.push(str);
    
}

a[Op.Regex] = function(block){
    let str = block.readString();
    let flags = block.readString();
    block._stack.push(new RegExp(str, flags));
    
}
a[Op.GetObjectProperty] = function(block){
    let prop = block._stack.pop();
    let obj = block._stack.pop();
    //block.log("#", prop, obj);
    block._stack.push(obj[prop]);
    
}
a[Op.MakeArray] = function(block){
    let elements = block.readI32();
    let arr = new Array(elements);
    for(let i = 0 ; i < elements; i++) arr[elements - i - 1 ] = block._stack.pop();
    block._stack.push(arr);
    //block.log("Create Array");
    
}
a[Op.Debugger] = function(block){
    debugger;
    
}

a[Op.Duplicate] = function(block){
    let v = block._stack.pop();
    block._stack.push(v);
    block._stack.push(v);
}

a[Op.MakeObject] = function(block){
    let props = block.readI32();
    let obj = {};
    let values = new Array(props * 2);
    for(let i = 0 ; i < props; i++){
        values[(props - i) * 2 - 1] = block._stack.pop();
        values[(props - i) * 2 - 1 - 1] = block._stack.pop();
    }
    for(let i = 0; i < props * 2; i +=2){
        obj[values[i]] = values[i + 1];
    }
    block._stack.push(obj);
    
}
a[Op.This] = function(block){
    block._stack.push(block.scope);
}

a[Op.SetObjectProperty] = function(block){
    
    let property = block._stack.pop();
    let obj = block._stack.pop();
    let value = block._stack.pop();
    block._stack.push(obj[property] = value);
}
a[Op.AssignValue] = function(block){
    let index = block.readI32();
    let value = block._stack.pop();
    block._stack.push(block.definitions[index].value = value);
    //block.log(`ASSIGN ${typeof(value) === "string" || typeof(value) === "number" ? value : typeof(value)} -> $${index}`);
    
}

// Short-circuit && / || are driven by the surrounding jump structure in
// codegen: this op is only reached on the "evaluate the right operand" path,
// where the stack holds [leftDuplicate, right]. The result must be the right
// operand's value, so we discard the leftover left duplicate and keep the top.
a[Op.Or] = function(block){
    let r = block._stack.pop();
    block._stack.pop();
    block._stack.push(r);
    //block.log("||")
}

a[Op.And] = function(block){
    let r = block._stack.pop();
    block._stack.pop();
    block._stack.push(r);
    //block.log("&&")
}

a[Op.NotSymbol] = function(block){
    let val = block._stack.pop();
    block._stack.push(!val);
    //block.log("!")
}

a[Op.NegateSymbol] = function(block){
    let val = block._stack.pop();
    block._stack.push(~val);
    //block.log("~")
}

a[Op.TypeOf] = function(block){
    let val = block._stack.pop();
    block._stack.push(typeof(val));
    //block.log("typeof")
}

a[Op.TypeOfGlobal] = function(block){
    let name = block._stack.pop();
    if(name in globalScope){
        block._stack.push(typeof globalScope[name]);
    }else{
        block._stack.push("undefined");
    }
}

a[Op.GetVariableValue] = function(block){
    let index = block.readI32();
    let value = block.definitions[index].value;
    block._stack.push(value);
    //block.log(`MOV ${block.blockId}-$${index} ${typeof(value) === "string" || typeof(value) === "number" ? value : typeof(value)} -> _stack`);
    
}
a[Op.I8] = function(block){
    let num = block.readI8();
    block._stack.push(num);
    //block.log(`MOV ${num} -> _stack`);
    
}
a[Op.I32] = function(block){
    let num = block.readI32();
    block._stack.push(num);
    //block.log(`MOV ${num} -> _stack`);
}

a[Op.F64] = function(block){
    let num = block.readF64();
    block._stack.push(num);
    //block.log(`MOV ${num} -> _stack`);
}

a[Op.BOOL] = function(block){
    let bool = !!block.readI8();
    //block.log(`MOV ${bool.toString()} -> _stack`);
    block._stack.push(bool);
    
}
a[Op.Jump] = function(block){
    let dst = block.readI32();
    block.ip = dst;
    //block.log(`JMP @${dst}`);
    
}
a[Op.JumpToBlock] = function(block){
    let blockid = block.readI32();
    //block.log(`JMP to Block ->${blockid}`);
    block.runChild(blockid).makeFn().apply(block.scope);
}
a[Op.JumpIfFalse] = function(block){
    let dst = block.readI32();
    let val = block._stack.pop();
    //block.log(`[JMP] From: ${block.ip} to @${dst}`);
    if(!val) block.ip = dst;
}

a[Op.New] = function(block){
    let totalArgs = block.readI32();
    let args = new Array(totalArgs);
    for(let i = 0 ; i < totalArgs; i++) args[totalArgs - i - 1] = block._stack.pop();
    let obj = block._stack.pop();
    let instace = construct(obj, args)
    block._stack.push(instace);
    
}
a[Op.END] = function(block){
    block.returnRegister = undefined;
    block.U++;
    block.ip = -1;
    block.S = [];
    
}
a[Op.LessThan] = function(block){
    let right = block._stack.pop();
    let left = block._stack.pop();
    block._stack.push(left < right);
    
}
a[Op.LessThanOrEqual] = function(block){
    let right = block._stack.pop();
    let left = block._stack.pop();
    block._stack.push(left <= right);
    
}
a[Op.GreaterThan] = function(block){
    let right = block._stack.pop();
    let left = block._stack.pop();
    block._stack.push(left > right);
    
}
a[Op.GreaterThanOrEqual] = function(block){
    let right = block._stack.pop();
    let left = block._stack.pop();
    block._stack.push(left >= right);
    
}
a[Op.EqualTo] = function(block){
    let right = block._stack.pop();
    let left = block._stack.pop();
    block._stack.push(left == right);
    
}
a[Op.EqualToStrict] = function(block){
    let right = block._stack.pop();
    let left = block._stack.pop();
    block._stack.push(left === right);
    
}
a[Op.NotEqualTo] = function(block){
    let right = block._stack.pop();
    let left = block._stack.pop();
    //block.log(`Comparing ${right} ${left}`);
    block._stack.push(left != right);
}
a[Op.NotEqualToStrict] = function(block){
    let right = block._stack.pop();
    let left = block._stack.pop();
    block._stack.push(left !== right);
}
a[Op.Add] = function(block){
    let right = block._stack.pop();
    let left = block._stack.pop();
    block._stack.push(left + right);
    
}
a[Op.Sub] = function(block){
    let right = block._stack.pop();
    let left = block._stack.pop();
    block._stack.push(left - right);
    
}
a[Op.Multiply] = function(block){
    let right = block._stack.pop();
    let left = block._stack.pop();
    block._stack.push(left * right);
}

a[Op.Divide] = function(block){
    let right = block._stack.pop();
    let left = block._stack.pop();
    block._stack.push(left / right);
    
}
a[Op.Remainder] = function(block){
    let right = block._stack.pop();
    let left = block._stack.pop();
    block._stack.push(left % right);
    
}
a[Op.InstanceOf] = function(block){
    let right = block._stack.pop();
    let left = block._stack.pop();
    block._stack.push(left instanceof right);
    
}
a[Op.MinusOutFront] = function(block){
    let val = block._stack.pop();
    block._stack.push(-val);
    
}
a[Op.PlusOutFront] = function(block){
    let val = block._stack.pop();
    block._stack.push(+val);
    
}
a[Op.Void] = function(block){
    let val = block._stack.pop();
    block._stack.push(void val);
}
a[Op.Delete] = function(block){
    let prop = block._stack.pop();
    let obj = block._stack.pop();
    block._stack.push(delete obj[prop]);
}
a[Op.In] = function(block){
    let right = block._stack.pop();
    let left = block._stack.pop();
    block._stack.push(left in right);
    
}
a[Op.Throw] = function(block){
    let arg = block._stack.pop();
    throw(arg);
}
a[Op.Null] = function(block){
    block._stack.push(null);
}
a[Op.BitAnd] = function(block){
    let right = block._stack.pop();
    let left = block._stack.pop();
    block._stack.push(left & right);
}
a[Op.BitOr] = function(block){
    let right = block._stack.pop();
    let left = block._stack.pop();
    block._stack.push(left | right);
    
}
a[Op.BitXOR] = function(block){
    let right = block._stack.pop();
    let left = block._stack.pop();
    block._stack.push(left ^ right);
    
}
a[Op.BitLeftShift] = function(block){
    let right = block._stack.pop();
    let left = block._stack.pop();
    block._stack.push(left << right);
    
}

a[Op.BitRightShift] = function(block){
    let right = block._stack.pop();
    let left = block._stack.pop();
    block._stack.push(left >> right);
    
}

a[Op.BitZeroFillRightShift] = function(block) {
    let right = block._stack.pop();
    let left = block._stack.pop();
    block._stack.push(left >>> right);   
}

a[Op.PlusPlus] = function(block){
    let varid = block.readI32();
    block._stack.push(block.definitions[varid].value++);
}

a[Op.MinusMinus] = function(block){
    let varid = block.readI32();
    block._stack.push(block.definitions[varid].value--);
}

a[Op.PrePlusPlus] = function(block){
    let varid = block.readI32();
    block._stack.push(++block.definitions[varid].value);
}

a[Op.PreMinusMinus] = function(block){
    let varid = block.readI32();
    block._stack.push(--block.definitions[varid].value);
}

// Exception handling: PushHandler records a catch target (absolute ip) plus the
// stack depth to unwind to; PopHandler removes it when the try body completes
// normally. The run loop (Emulator.ts) consumes these on throw.
a[Op.PushHandler] = function(block){
    let addr = block.readI32();
    block.k.push([addr, block._stack.length]);
}

a[Op.PopHandler] = function(block){
    block.k.pop();
}

a[Op.RaiseExponent] = function(block){
    let right = block._stack.pop();
    let left = block._stack.pop();
    block._stack.push(left ** right);
}

a[Op.GetArgs] = function(block){
    block._stack.push(block.args);
}

a[Op.JumpToStart] = function(block){
    block.ip = 0;
}
