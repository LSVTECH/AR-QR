"""Reemplaza una textura dentro de un GLB o un USDZ sin pasar por Blender.

python reemplazar_textura.py modelo.glb  <nombre_de_imagen> nueva.jpg [<nombre> nueva.jpg ...]
python reemplazar_textura.py modelo.usdz <ruta_en_el_paquete> nueva.jpg [...]

GLB: <nombre> es el «name» de la imagen (glb_info.py lo lista); se reconstruye el trozo BIN.
USDZ: <ruta> es la del archivo dentro del paquete (p. ej. 1/t010_..._BaseColor_c.jpg); la imagen se
reduce al tamaño de la original y el paquete se rearma sin comprimir y con los datos alineados a
64 bytes, como exige Quick Look.
"""
import io
import json
import struct
import sys
import zipfile

from PIL import Image

ruta, pares = sys.argv[1], sys.argv[2:]
cambios = dict(zip(pares[::2], pares[1::2]))


def jpg_como(original_bytes, nueva_ruta):
    tam = Image.open(io.BytesIO(original_bytes)).size
    im = Image.open(nueva_ruta).convert("RGB")
    if im.size != tam:
        im = im.resize(tam, Image.LANCZOS)
    b = io.BytesIO()
    im.save(b, "JPEG", quality=88, optimize=True)
    return b.getvalue()


if ruta.endswith(".glb"):
    d = open(ruta, "rb").read()
    jlen = struct.unpack("<I", d[12:16])[0]
    j = json.loads(d[20:20 + jlen])
    blen = struct.unpack("<I", d[20 + jlen:24 + jlen])[0]
    binario = d[28 + jlen:28 + jlen + blen]
    nuevos = {}
    for im in j["images"]:
        if im.get("name") in cambios:
            bv = j["bufferViews"][im["bufferView"]]
            viejo = binario[bv.get("byteOffset", 0):bv.get("byteOffset", 0) + bv["byteLength"]]
            nuevos[im["bufferView"]] = jpg_como(viejo, cambios.pop(im["name"]))
            im["mimeType"] = "image/jpeg"
    assert not cambios, f"no encontradas: {list(cambios)}"
    salida = bytearray()
    for i, bv in enumerate(j["bufferViews"]):
        datos = nuevos.get(i) or binario[bv.get("byteOffset", 0):bv.get("byteOffset", 0) + bv["byteLength"]]
        salida += b"\0" * (-len(salida) % 8)
        bv["byteOffset"] = len(salida)
        bv["byteLength"] = len(datos)
        salida += datos
    salida += b"\0" * (-len(salida) % 4)
    j["buffers"][0]["byteLength"] = len(salida)
    js = json.dumps(j, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    total = 12 + 8 + len(js) + 8 + len(salida)
    open(ruta, "wb").write(struct.pack("<4sII", b"glTF", 2, total) + struct.pack("<I4s", len(js), b"JSON") + js
                           + struct.pack("<I4s", len(salida), b"BIN\0") + bytes(salida))
else:
    viejo = zipfile.ZipFile(ruta)
    entradas = [(i.filename, viejo.read(i.filename)) for i in viejo.infolist()]
    viejo.close()
    entradas = [(n, jpg_como(b, cambios.pop(n)) if n in cambios else b) for n, b in entradas]
    assert not cambios, f"no encontradas: {list(cambios)}"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as z:
        for nombre, datos in entradas:
            info = zipfile.ZipInfo(nombre, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_STORED
            inicio = buf.tell() + 30 + len(nombre.encode())
            relleno = (-(inicio + 4)) % 64
            info.extra = struct.pack("<HH", 0x1986, relleno) + b"\0" * relleno
            z.writestr(info, datos)
    open(ruta, "wb").write(buf.getvalue())
    # Comprobación: todos los datos alineados a 64 bytes.
    with zipfile.ZipFile(ruta) as z, open(ruta, "rb") as f:
        for i in z.infolist():
            f.seek(i.header_offset + 26)
            n, e = struct.unpack("<HH", f.read(4))
            assert (i.header_offset + 30 + n + e) % 64 == 0, i.filename
print("listo", ruta)
