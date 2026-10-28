#!/usr/bin/env python3
"""Injecte les localités belges dans la migration 034 (28/10/2026).

Source : le jeu public « zipcode-belgium » (codes postaux bpost),
https://github.com/jief/zipcode-belgium — fichier zipcode-belgium.json,
une ligne { "zip": "1000", "city": "Bruxelles", ... } par localité.

    python3 -I scripts/generer-localites.py chemin/vers/zipcode-belgium.json

Réécrit la chaîne $localites$…$localites$ de la migration : « cp nom;cp nom;… »,
triée, sans doublon. La province ne vient PAS du fichier : elle se lit sur le
code postal (public.province_du_cp), ce qui évite toute erreur de saisie.
"""
import json
import re
import sys
from pathlib import Path

MIGRATION = Path(__file__).resolve().parent.parent / "supabase" / "migrations" / "034_commune_region.sql"

# Le jeu source perd l'accent des majuscules (« Eghezée »). Seuls les noms
# officiels de COMMUNE dont on est sûr sont corrigés ici ; ailleurs, la règle
# garde la graphie que la personne a tapée quand c'est le même nom.
CORRECTIONS = {
    "Eghezée": "Éghezée",
    "Erezée": "Érezée",
    "Etalle": "Étalle",
    "Ecaussinnes": "Écaussinnes",
    "Ecaussinnes-D'enghien": "Écaussinnes-d'Enghien",
    "Ecaussinnes-Lalaing": "Écaussinnes-Lalaing",
}


def main(source: str) -> None:
    lignes = json.loads(Path(source).read_text(encoding="utf-8"))
    couples = set()
    for r in lignes:
        cp, nom = str(r["zip"]).strip(), str(r["city"]).strip()
        if not re.fullmatch(r"[1-9]\d{3}", cp) or not nom or ";" in nom or "$" in nom:
            raise SystemExit(f"ligne inattendue : {r!r}")
        couples.add((int(cp), CORRECTIONS.get(nom, nom)))
    donnees = ";".join(f"{cp} {nom}" for cp, nom in sorted(couples))
    sql = MIGRATION.read_text(encoding="utf-8")
    nouveau, n = re.subn(r"\$localites\$.*?\$localites\$", lambda _: f"$localites${donnees}$localites$", sql, flags=re.S)
    if n != 1:
        raise SystemExit("chaîne $localites$ introuvable dans la migration")
    MIGRATION.write_text(nouveau, encoding="utf-8")
    print(f"{len(couples)} localités écrites dans {MIGRATION.name}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
