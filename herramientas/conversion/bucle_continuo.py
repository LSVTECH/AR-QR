"""Hace continuo el bucle de la animación de un GLB fundiendo su final con su inicio.

python bucle_continuo.py modelo.glb [cuadros_de_fundido]

Si el último cuadro no coincide con el primero, al repetirse la animación los personajes
«saltan». Con K cuadros de fundido, el clip nuevo dura N-K cuadros: los primeros K mezclan el
final del clip original con su inicio (de 0 a 1), así el último cuadro nuevo empalma con el
primero. Se reutiliza la misma animación; solo se recorta y se mezcla. Se escribe en el sitio
(los datos de animación no van comprimidos con Draco).
"""
import json
import struct
import sys

import numpy as np

ruta = sys.argv[1]
K = int(sys.argv[2]) if len(sys.argv) > 2 else 30

datos = bytearray(open(ruta, "rb").read())
jlen = struct.unpack("<I", datos[12:16])[0]
j = json.loads(datos[20:20 + jlen])
base_bin = 20 + jlen + 8
COMP = {"SCALAR": 1, "VEC3": 3, "VEC4": 4}


def vista(i):
    a = j["accessors"][i]
    bv = j["bufferViews"][a["bufferView"]]
    assert a["componentType"] == 5126 and not bv.get("byteStride")
    n = COMP[a["type"]]
    o = base_bin + bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    return np.frombuffer(datos, dtype="<f4", count=a["count"] * n, offset=o).reshape(a["count"], n).copy(), o


def escribir(i, v):
    a = j["accessors"][i]
    _, o = vista(i)
    v = np.asarray(v, dtype="<f4")
    assert len(v) <= a["count"], "el canal nuevo no puede ser más largo que el original"
    b = v.tobytes()
    datos[o:o + len(b)] = b
    a["count"] = len(v)
    a["min"] = v.min(0).tolist()
    a["max"] = v.max(0).tolist()


for an in j["animations"]:
    entradas = {s["input"] for s in an["samplers"]}
    largas = [i for i in entradas if j["accessors"][i]["count"] > 2 * K]
    assert len(largas) == 1, "se espera una sola línea de tiempo con todos los cuadros"
    t, _ = vista(largas[0])
    N = len(t)
    M = N - K
    paso = float(t[1, 0] - t[0, 0])
    dur = paso * (M - 1)
    w = np.linspace(0, 1, K, endpoint=False)
    w = w * w * (3 - 2 * w)  # suave al entrar y al salir

    hechos = set()
    for s in an["samplers"]:
        o = s["output"]
        if s["input"] != largas[0] or o in hechos:
            continue
        hechos.add(o)
        v, _ = vista(o)
        cola, cabeza = v[N - K:].copy(), v[:K].copy()
        if v.shape[1] == 4:  # cuaterniones: mismo hemisferio antes de mezclar
            signo = np.sign((cola * cabeza).sum(1, keepdims=True))
            signo[signo == 0] = 1
            cola *= signo
        mezcla = cola * (1 - w[:, None]) + cabeza * w[:, None]
        if v.shape[1] == 4:
            mezcla /= np.linalg.norm(mezcla, axis=1, keepdims=True)
        nuevo = np.concatenate([mezcla, v[K:M]])
        escribir(o, nuevo)

    escribir(largas[0], (np.arange(M, dtype=np.float64) * paso + float(t[0, 0]))[:, None])
    # Canales constantes (2 claves): que terminen junto con el clip nuevo.
    for i in entradas - {largas[0]}:
        tc, _ = vista(i)
        tc[-1, 0] = tc[0, 0] + dur
        escribir(i, tc)
    print(f"{an.get('name')}: {N} -> {M} cuadros, {paso * (N - 1):.2f} s -> {dur:.2f} s, fundido de {K} cuadros")

js = json.dumps(j, separators=(",", ":")).encode()
js += b" " * (-len(js) % 4)
binario = bytes(datos[20 + jlen:])  # cabecera del trozo BIN + datos, tal cual
salida = struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(js) + len(binario)) + struct.pack("<I4s", len(js), b"JSON") + js + binario
open(ruta, "wb").write(salida)
