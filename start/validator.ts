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
  },
  {
    nom: 'nom',
    email: 'email',
    password: 'mot de passe',
  }
)
