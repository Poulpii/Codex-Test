# Suivi Copro Local

![Capture d’écran de Copropro](Screenshot%20%20Copropro%20%E2%80%94%20Sujets%20de%20Coproprie%CC%81te%CC%81.png)

Application web locale pour suivre les sujets d’une copropriété : incidents, demandes, documents, actions à mener et état d’avancement.

L’app fonctionne en local avec Node.js, sans base de données externe. Les sujets sont enregistrés sous forme de fichiers Markdown et les pièces jointes sont stockées dans un dossier dédié.

## Fonctionnalités

- Tableau de bord des sujets actifs, urgents, à traiter, partiellement traités et traités.
- Création de nouveaux sujets depuis l’interface.
- Classement par filtres ou bâtiments.
- Configuration Markdown de l’adresse de copropriété, du syndic et des filtres.
- Recherche par titre, contenu, mot-clé ou document.
- Édition locale des sujets.
- Ajout et suppression de pièces jointes.
- Explorateur de documents intégré.
- Explorateur de documents organisé par année, filtres actifs et archives.
- Changement de thème clair / sombre.
- Stockage local simple dans des dossiers `Contents`, `Documents` et `assets`.

## Aperçu du projet

```text
.
├── index.html              # Interface principale
├── server.js               # Serveur local Node.js
├── package.json            # Script de démarrage
├── Contents/               # Sujets Markdown classés par année et filtre
├── Documents/              # Pièces jointes classées par année
├── assets/
│   ├── app.js              # Logique front-end
│   ├── styles.css          # Styles de l’application
│   └── config.md           # Adresse, syndic et filtres affichés
└── Demarrer web app.command # Lanceur macOS optionnel
```

## Prérequis

- Node.js 18 ou supérieur
- npm

Vérifier l’installation :

```bash
node -v
npm -v
```

## Installation

Cloner le dépôt :

```bash
git clone https://github.com/votre-utilisateur/votre-depot.git
cd votre-depot
```

Installer les dépendances :

```bash
npm install
```

## Lancement

Démarrer l’application :

```bash
npm start
```

Ouvrir ensuite :

```text
http://127.0.0.1:3000
```

Sur macOS, il est aussi possible d’utiliser le fichier :

```text
Demarrer web app.command
```

Ce lanceur ouvre automatiquement l’application dans le navigateur et cherche un port disponible si le port 3000 est déjà utilisé.

## Partage sur le réseau local

Pour rendre l’application accessible depuis un autre appareil du même réseau :

```bash
COPROPRO_ACCESS_TOKEN="un-mot-de-passe-long" HOST=0.0.0.0 npm start
```

Ouvrir ensuite l’application depuis l’autre appareil avec le jeton :

```text
http://adresse-ip-de-la-machine:3000/?token=un-mot-de-passe-long
```

L’application restera servie par le serveur local. Vérifier les paramètres de pare-feu de la machine si l’accès réseau ne fonctionne pas.

Par sécurité, le serveur refuse désormais un lancement réseau (`HOST` non local) si `COPROPRO_ACCESS_TOKEN` n’est pas défini.

## Format des sujets

Chaque sujet est enregistré en Markdown dans le dossier `Contents`, dans un sous-dossier par année puis par filtre.

Exemple :

```text
Contents/
└── 2026/
    ├── Général/
    │   └── 0002-02-juin-2026-Vitre-Porte-Entree-Brisee.md
    └── Bâtiment A (Rue)/
        └── 0001-02-juin-2026-Infiltration-Eau-Cage-Escalier-Bat-A.md
```

Un sujet peut contenir :

- un titre ;
- une date de création ;
- une catégorie ou un filtre ;
- un niveau de priorité ;
- un statut ;
- un contexte ;
- des actions proposées ;
- des documents associés.

Les pièces jointes ajoutées depuis l’interface sont copiées dans `Documents`, également dans un sous-dossier par année.

Exemple :

```text
Documents/
└── 2026/
    ├── Vitre-Brisee.png
    └── LRR-Syndic-a-Copro.pdf
```

Dans l’explorateur de documents de l’interface, les fichiers sont regroupés par année. Les documents rattachés uniquement à des sujets traités sont affichés dans `Archives`, sauf s’ils sont encore utilisés par au moins un autre sujet non traité.

Les pièces jointes acceptées sont limitées aux formats courants non exécutables : images (`png`, `jpg`, `jpeg`, `gif`, `webp`, `avif`), `pdf`, `eml`, `msg`, `txt`, `md`, `csv`, `rtf`, documents Office (`doc`, `docx`, `xls`, `xlsx`, `ppt`, `pptx`). Les fichiers actifs comme `html`, `svg`, `js` ou `css` sont bloqués.

## Configuration

La configuration générale est stockée dans `assets/config.md`.

Ce fichier contient :

- l’adresse de la copropriété ;
- le nom du syndic ;
- la liste et l’ordre des filtres affichés dans l’application.

Format attendu :

```md
# Configuration

## Copropriété

Adresse: l'adresse de votre copropriété
Syndic: Nom du Syndic

## Filtres

- Bâtiment A (Rue)
- Général
```

Au démarrage, l’application lit cette configuration via le serveur local. Si le serveur n’est pas disponible, le navigateur peut lire `assets/config.md` en secours, mais les modifications ne pourront pas être enregistrées.

Les changements faits depuis l’interface en mode édition sont enregistrés dans `assets/config.md` :

- modification du texte d’adresse / syndic dans l’en-tête ;
- ajout d’un filtre ;
- renommage d’un filtre ;
- suppression d’un filtre vide ;
- réorganisation des filtres par glisser-déposer.

Les filtres restent liés aux dossiers de `Contents/<année>/`. Lorsqu’un filtre est ajouté ou renommé, le serveur crée ou renomme le dossier correspondant dans les années concernées et met à jour les sujets Markdown.

## Données locales

Cette application ne nécessite pas de service cloud ni de base de données distante.

Les données importantes sont principalement stockées dans :

```text
Contents/
Documents/
assets/config.md
```

Pour sauvegarder le projet, conserver ces dossiers et le fichier `assets/config.md` avec les fichiers de l’application.

## Scripts disponibles

```bash
npm start
```

Lance le serveur local avec `server.js`.

## Déploiement GitHub

Ce projet peut être publié sur GitHub comme dépôt de code.

Pour une utilisation complète, l’application doit être lancée avec Node.js, car elle utilise un serveur local pour lire et écrire les sujets Markdown ainsi que les documents.

GitHub Pages seul ne suffit pas pour les fonctions d’écriture locales, car GitHub Pages sert uniquement des fichiers statiques.

## Sécurité et usage

Cette application est prévue pour un usage local ou sur un réseau de confiance.

Si l’application est partagée sur le réseau local, définir `COPROPRO_ACCESS_TOKEN` et transmettre l’URL avec `?token=...` uniquement aux personnes autorisées.

Avant de publier le dépôt, vérifier que les dossiers suivants ne contiennent pas de documents privés ou sensibles :

```text
Contents/
Documents/
assets/config.md
```

## Licence

Ajouter ici la licence souhaitée, par exemple MIT, si le projet doit être partagé publiquement.
