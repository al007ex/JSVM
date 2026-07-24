const __F64__ = new Float64Array(1);
const __I8__ = new Uint8Array(__F64__.buffer);

export const isWholeNumber = (n: number): boolean => (n % 1) === 0;
export const isValidI8 = (n: number): boolean => (n >= 0 && n <= 0xff && isWholeNumber(n));
export const isValidI32 = (n: number): boolean => (n >= 0 && n <= 0xffffffff && isWholeNumber(n));

export function i8Bytes(n: number): number{
    if(!isValidI8(n)) throw new Error("Invalid i8 provided: " + n);
    return n;
}

export function HOP(obj, val){
    return Object.hasOwnProperty.apply(obj, [val]);
}

export function i32Bytes(n: number): Uint8Array{
    if(!isValidI32(n)) throw new Error("Invlaid i32 provided: " + n);
    return new Uint8Array([
        n & 0xff,
        (n >> 8) & 0xff,
        (n >> 16) & 0xff,
        (n >> 24) & 0xff
    ]);
}

export function f64Bytes(n: number): Uint8Array{
    __F64__[0] = n;
    let copy = __I8__.slice();
    return copy;
}

// ---------------------------------------------------------------------------
// Tier 1 hardening — build-side crypto.
//
// IMPORTANT: `ksByte` and `hash32` below must stay byte-for-byte identical to
// the `__ks` / `__hash32` copies embedded in src/Emulator.ts. The build side
// encrypts with these; the runtime decrypts with those. If you change one,
// change the other or every compiled bundle breaks.
// ---------------------------------------------------------------------------

// Position-keyed keystream byte. Pure function of (position, seed) so the VM
// can decrypt random-access reads (jumps re-read the same byte at the same
// position and must get the same key). Avalanches with an xorshift/imul mix.
export function ksByte(i: number, seed: number): number {
    let x = (seed ^ (i + 0x9E3779B9)) | 0;
    x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
    x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
    x = (x ^ (x >>> 16)) | 0;
    return x & 0xff;
}

// FNV-1a 32-bit. Used to derive the integrity value the runtime folds back
// into the cipher seed (checksum-as-key).
export function hash32(str: string): number {
    let h = 0x811c9dc5 | 0;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
    return h | 0;
}

// XOR the whole bytecode buffer with the position-keyed keystream.
export function encryptBytecode(raw: Uint8Array, seed: number): Uint8Array {
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = (raw[i] ^ ksByte(i, seed)) & 0xff;
    return out;
}
