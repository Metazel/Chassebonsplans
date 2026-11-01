"""Tests de l'extraction des horaires sur un GTFS fabriqué (bibliothèque standard)."""

import io
import json
import subprocess
import sys
import tempfile
import unittest
import zipfile
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import extraire_horaires as ex  # noqa: E402


def gtfs(fichiers: dict[str, str]) -> zipfile.ZipFile:
    tampon = io.BytesIO()
    with zipfile.ZipFile(tampon, "w") as z:
        for nom, contenu in fichiers.items():
            z.writestr(nom, contenu)
    tampon.seek(0)
    return zipfile.ZipFile(tampon)


SNCF = {
    "agency.txt": "agency_id,agency_name\nA,SNCF\n",
    "stops.txt": "stop_id,stop_name\nM,Marseille Saint-Charles\nA,Aix-en-Provence TGV\nL,Lyon Part-Dieu\nP,Paris Gare de Lyon\nX,Marseille Blancarde\n",
    "routes.txt": "route_id,agency_id,route_short_name,route_desc\nR1,A,TGV INOUI,\nR2,A,OUIGO,\nR3,A,TER,TER\n",
    "trips.txt": "route_id,service_id,trip_id,trip_short_name\nR1,S1,T1,6102\nR2,S2,T2,7808\nR1,S1,T3,6177\nR3,S1,T4,17000\nR1,S1,T5,6200\n",
    "stop_times.txt": (
        "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n"
        # T1 Marseille -> Paris via Aix
        "T1,06:00:00,06:00:00,M,1\nT1,06:15:00,06:16:00,A,2\nT1,09:20:00,09:20:00,P,3\n"
        # T2 OUIGO Marseille -> Paris
        "T2,06:10:00,06:10:00,M,1\nT2,09:35:00,09:35:00,P,2\n"
        # T3 Paris -> Marseille, arrivée après minuit (horaire GTFS > 24 h)
        "T3,22:30:00,22:30:00,P,1\nT3,25:50:00,25:50:00,M,2\n"
        # T4 TER Marseille -> Lyon : ne va pas à Paris
        "T4,07:00:00,07:00:00,M,1\nT4,10:30:00,10:30:00,L,2\n"
        # T5 Marseille Blancarde -> Paris : autre gare de Marseille, exclue
        "T5,06:05:00,06:05:00,X,1\nT5,09:30:00,09:30:00,P,2\n"
    ),
    "calendar.txt": "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nS1,1,1,1,1,1,0,0,20261102,20261113\nS2,0,0,1,0,0,0,0,20261102,20261113\n",
    "calendar_dates.txt": "service_id,date,exception_type\nS1,20261111,2\nS2,20261107,1\n",
}

TRENITALIA = {
    "agency.txt": "agency_id,agency_name\nTI,Trenitalia France\n",
    "stops.txt": "stop_id,stop_name\nPGL,PARIS GARE DE LYON\nMSC,MARSEILLE ST CHARLES\n",
    "routes.txt": "route_id,agency_id,route_short_name\n6119,TI,Paris-Gare-de-Lyon/Marseille-St-Charles\n",
    "trips.txt": "route_id,service_id,trip_id\n6119,W,70073\n",
    "stop_times.txt": "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n70073,,06:52:00,MSC,1\n70073,10:12:00,,PGL,2\n",
    "calendar.txt": "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nW,1,1,1,1,1,1,1,20261102,20261104\n",
}

DEBUT, FIN = date(2026, 11, 2), date(2026, 11, 30)


class Extraction(unittest.TestCase):
    def test_sncf_sens_operateurs_et_gares(self):
        trains = ex.extraire(gtfs(SNCF), "SNCF Voyageurs", DEBUT, FIN)
        par_num = {t["numero"]: t for t in trains}
        self.assertEqual(set(par_num), {"6102", "7808", "6177"}, "TER vers Lyon et départ de Marseille Blancarde exclus")
        self.assertEqual(par_num["6102"]["sens"], "MP")
        self.assertEqual(par_num["6102"]["depart"], 6 * 60)
        self.assertEqual(par_num["6102"]["arrivee"], 9 * 60 + 20)
        self.assertEqual(par_num["7808"]["operateur"], "OUIGO")
        self.assertEqual(par_num["6177"]["sens"], "PM")
        self.assertEqual(par_num["6177"]["arrivee"], 25 * 60 + 50, "heure GTFS au-delà de 24 h conservée")

    def test_calendrier_et_exceptions(self):
        trains = {t["numero"]: t for t in ex.extraire(gtfs(SNCF), "SNCF Voyageurs", DEBUT, FIN)}
        jours = trains["6102"]["jours"]
        self.assertNotIn("2026-11-11", jours, "11 novembre retiré par exception")
        self.assertNotIn("2026-11-07", jours, "samedi hors calendrier")
        self.assertEqual(len(jours), 9)
        self.assertIn("2026-11-07", trains["7808"]["jours"], "ajout ponctuel")

    def test_trenitalia_noms_en_majuscules_et_heures_manquantes(self):
        trains = ex.extraire(gtfs(TRENITALIA), "Trenitalia France", DEBUT, FIN)
        self.assertEqual(len(trains), 1)
        self.assertEqual(trains[0]["operateur"], "Trenitalia (Frecciarossa)")
        self.assertEqual(trains[0]["numero"], "6119", "numéro commercial Trenitalia = route_id")
        self.assertEqual(trains[0]["depart"], 6 * 60 + 52)
        self.assertEqual(trains[0]["arrivee"], 10 * 60 + 12)

    def test_regroupement_compact(self):
        trains = ex.extraire(gtfs(SNCF), "SNCF Voyageurs", DEBUT, FIN)
        groupes = ex.regrouper(trains, DEBUT)
        g = next(x for x in groupes if x["n"] == "6102")
        self.assertEqual(g["j"][0], 0, "décalage en jours depuis le début")
        self.assertEqual(set(g), {"s", "n", "o", "gd", "ga", "d", "a", "j"})

    def test_ligne_de_commande_fichiers_locaux(self):
        with tempfile.TemporaryDirectory() as d:
            for nom, contenu in (("sncf.zip", SNCF), ("trenitalia.zip", TRENITALIA)):
                with zipfile.ZipFile(Path(d) / nom, "w") as z:
                    for f, c in contenu.items():
                        z.writestr(f, c)
            sortie = Path(d) / "h.json"
            subprocess.run(
                [sys.executable, str(Path(__file__).parent / "extraire_horaires.py"), "--gtfs", str(Path(d) / "sncf.zip"),
                 "--gtfs", str(Path(d) / "trenitalia.zip"), "--debut", "2026-11-02", "--sortie", str(sortie)],
                check=True, capture_output=True,
            )
            data = json.loads(sortie.read_text(encoding="utf-8"))
            self.assertEqual(data["debut"], "2026-11-02")
            self.assertEqual({t["o"] for t in data["trains"]}, {"TGV INOUI", "OUIGO", "Trenitalia (Frecciarossa)"})
            # Trenitalia ne couvre que jusqu'au 4 novembre : la période annoncée s'y arrête (pas de « tous opérateurs » faux).
            self.assertEqual(data["fin"], "2026-11-04")
            self.assertTrue(all(max(t["j"]) <= 2 for t in data["trains"]), "aucun jour au-delà de la période")

    def test_ordre_des_passages_independant_du_fichier(self):
        desordre = {**SNCF, "stop_times.txt": (
            "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n"
            "T1,09:20:00,09:20:00,P,3\nT1,06:15:00,06:16:00,A,2\nT1,06:00:00,06:00:00,M,1\n"
        )}
        t = next(x for x in ex.extraire(gtfs(desordre), "SNCF Voyageurs", DEBUT, FIN) if x["numero"] == "6102")
        self.assertEqual((t["sens"], t["depart"], t["arrivee"]), ("MP", 6 * 60, 9 * 60 + 20))

    def test_train_sans_numero_ecarte(self):
        sans = {**SNCF, "trips.txt": "route_id,service_id,trip_id,trip_short_name\nR1,S1,T1,\nR2,S2,T2,7808\n"}
        self.assertEqual([t["numero"] for t in ex.extraire(gtfs(sans), "SNCF Voyageurs", DEBUT, FIN)], ["7808"])

    def test_operateur_depuis_l_identifiant_d_arret_sncf(self):
        self.assertEqual(ex.operateur("SNCF Voyageurs", {}, {}, "StopPoint:OCEOUIGO-87751008"), "OUIGO")
        self.assertEqual(ex.operateur("SNCF Voyageurs", {}, {}, "StopPoint:OCETGV INOUI-87751008"), "TGV INOUI")
        self.assertEqual(ex.operateur("SNCF Voyageurs", {"nom": "OUIGO"}, {}, "M"), "OUIGO")

    def test_numero_de_secours(self):
        self.assertEqual(ex.numero({"trip_short_name": "6102"}), "6102")
        self.assertEqual(ex.numero({"trip_short_name": "", "trip_headsign": "9241"}), "9241")
        self.assertEqual(ex.numero({"trip_id": "FR_9241_20261102"}), "9241")
        self.assertEqual(ex.numero({"trip_id": "abc"}), "")

    def test_normalisation_des_gares(self):
        self.assertTrue(ex.est_marseille("MARSEILLE ST CHARLES"))
        self.assertTrue(ex.est_marseille("Marseille-Saint-Charles"))
        self.assertFalse(ex.est_marseille("Marseille Blancarde"))
        self.assertTrue(ex.est_paris("Paris Gare de Lyon Hall 1 & 2"))
        self.assertFalse(ex.est_paris("Marne-la-Vallée Chessy"))


if __name__ == "__main__":
    unittest.main()
