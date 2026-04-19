declare module 'jsencrypt' {
  export default class JSEncrypt {
    setPublicKey(pk: string): void;
    setPrivateKey(pk: string): void;
    encrypt(txt: string): string | false;
    decrypt(txt: string): string | false;
  }
}
