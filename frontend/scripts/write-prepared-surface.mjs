import {writeFileSync} from 'node:fs'

/** Local review artifact: numeric geometry and captured RGB, with no executable content. */
export function writePreparedSurface(path, prepared) {
  const arrays=[]
  const metadata=Buffer.from(JSON.stringify(prepared, (_key,value)=>{
    if(ArrayBuffer.isView(value)){
      const id=arrays.push(Buffer.from(value.buffer,value.byteOffset,value.byteLength))-1
      return {bufferId:id,kind:value.constructor.name,length:value.length}
    }
    return value
  }))
  const header=Buffer.alloc(4);header.writeUInt32LE(metadata.length)
  writeFileSync(path,Buffer.concat([header,metadata,...arrays]))
}
