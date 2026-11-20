# setoudie.github.io

Portfolio de **Seny Toutou Diedhiou**, Data & AI Developer à Dakar : https://setoudie.github.io/

L'accueil est une carte interactive : des points de vente simulés sont regroupés en direct par
l'algorithme DBSCAN. On peut changer le rayon `eps` et ajouter des points d'un clic.

## Structure

```
site/
  index.html              contenu de toutes les sections
  404.html                page « point isolé »
  favicon.svg
  assets/
    css/style.css         couleurs, typographie et mise en page (variables en haut du fichier)
    js/field.js           carte DBSCAN de l'accueil
    js/main.js            navigation, apparition au défilement, copie de l'e-mail
    img/seny.png          photo de profil
    Seny_Toutou_Diedhiou_CV.pdf
```

Le site est en HTML, CSS et JavaScript, sans framework ni étape de build.

## Modifier le contenu

- Expériences, projets, compétences, formation, certifications : directement dans `site/index.html`.
- Couleurs : variables `--c1` à `--c7` en haut de `site/assets/css/style.css`.
- CV : remplacer `site/assets/Seny_Toutou_Diedhiou_CV.pdf` en gardant le même nom.

## Voir le site en local

```bash
cd site
python -m http.server 8000
# puis ouvrir http://localhost:8000
```

## Mise en ligne

Chaque push sur `main` déclenche le workflow `.github/workflows/deploy.yml`, qui publie le dossier
`site/` sur la branche `gh-pages` servie par GitHub Pages.

L'ancien portfolio React est conservé dans la branche `legacy-react-portfolio`.
