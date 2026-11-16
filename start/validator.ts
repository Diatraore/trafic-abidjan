/*
|--------------------------------------------------------------------------
| Messages de validation en français
|--------------------------------------------------------------------------
|
| VineJS affiche ses messages en anglais par défaut. Ce fichier, chargé au
| démarrage (voir "preloads" dans adonisrc.ts), les remplace par des
| messages en français.
|
*/

import vine, { SimpleMessagesProvider } from '@vinejs/vine'

vine.messagesProvider = new SimpleMessagesProvider(
  {
    'required': 'Le champ {{ field }} est obligatoire.',
    'string': 'Le champ {{ field }} doit être un texte.',
    'email': "L'adresse email n'est pas valide.",
    'minLength': 'Le champ {{ field }} doit contenir au moins {{ min }} caractères.',
    'maxLength': 'Le champ {{ field }} doit contenir au plus {{ max }} caractères.',
    'confirmed': 'Les deux mots de passe ne correspondent pas.',
    'database.unique': 'Cette adresse email est déjà utilisée.',
    'number': 'Le champ {{ field }} doit être un nombre.',
    'min': 'Le champ {{ field }} doit être supérieur ou égal à {{ min }}.',
    'max': 'Le champ {{ field }} doit être inférieur ou égal à {{ max }}.',
    'arrivee.notSameAs': "Le lieu d'arrivée doit être différent du lieu de départ.",
    'date_deplacement.regex': 'Veuillez choisir une date valide.',
    'heure_deplacement.regex': 'Veuillez choisir une heure valide (HH:MM).',
  },
  {
    nom: 'nom',
    email: 'email',
    password: 'mot de passe',
    depart: 'lieu de départ',
    arrivee: "lieu d'arrivée",
    date_deplacement: 'date du déplacement',
    heure_deplacement: 'heure du déplacement',
    depart_latitude: 'latitude de départ',
    depart_longitude: 'longitude de départ',
    arrivee_latitude: "latitude d'arrivée",
    arrivee_longitude: "longitude d'arrivée",
  }
)
