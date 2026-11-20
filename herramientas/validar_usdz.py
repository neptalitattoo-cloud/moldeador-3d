#!/usr/bin/env python3
"""Valida uno o varios .usdz con el marco de validación de USD (usd-core ≥ 26.3; sustituye a usdchecker. Probado con 26.3 y 26.11: en 25.x el wheel de pip falla al cargar los validadores de Hydra).
python3 herramientas/validar_usdz.py brazo_cliente.usdz [...]   -> sale con error si hay errores."""

import sys

from pxr import Usd, UsdValidation

reg = UsdValidation.ValidationRegistry()
ctx = UsdValidation.ValidationContext(reg.GetOrLoadValidatorsByName([m.name for m in reg.GetAllValidatorMetadata()]))
mal = 0
for f in sys.argv[1:]:
    errs = ctx.Validate(Usd.Stage.Open(f))
    mal += len(errs)
    print(f, 'OK' if not errs else f'{len(errs)} problema(s)')
    for e in errs:
        print('  -', e.GetMessage())
sys.exit(1 if mal else 0)
