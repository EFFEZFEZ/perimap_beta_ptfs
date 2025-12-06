/**
 * trie.js
 * Structure de données Trie pour l'autocomplétion rapide
 * 
 * 🔴 STATUT: DÉSACTIVÉ - Code préparé pour le futur
 * 
 * Un Trie (arbre préfixé) permet des recherches en O(m) où m est
 * la longueur de la requête, indépendamment du nombre de mots.
 * 
 * Idéal pour l'autocomplétion avec des milliers d'arrêts/lieux.
 */

/**
 * Nœud du Trie
 */
class TrieNode {
  constructor() {
    this.children = new Map(); // caractère -> TrieNode
    this.isEndOfWord = false;
    this.data = []; // Données associées à ce mot (plusieurs entrées possibles)
  }
}

/**
 * Structure Trie pour l'autocomplétion
 */
export class Trie {
  constructor() {
    this.root = new TrieNode();
    this.wordCount = 0;
  }

  /**
   * Normalise un texte pour la recherche
   * - Minuscules
   * - Supprime les accents
   * - Supprime les caractères spéciaux
   * 
   * @param {string} text
   * @returns {string}
   */
  normalize(text) {
    if (!text) return '';
    
    return text
      .toLowerCase()
      .normalize('NFD') // Décompose les caractères accentués
      .replace(/[\u0300-\u036f]/g, '') // Supprime les diacritiques
      .replace(/[^a-z0-9\s]/g, '') // Garde uniquement lettres, chiffres, espaces
      .trim();
  }

  /**
   * Insère un mot dans le Trie
   * 
   * @param {string} word - Mot à insérer
   * @param {Object} data - Données associées (arrêt, lieu, etc.)
   */
  insert(word, data) {
    const normalizedWord = this.normalize(word);
    if (!normalizedWord) return;

    let node = this.root;

    for (const char of normalizedWord) {
      if (!node.children.has(char)) {
        node.children.set(char, new TrieNode());
      }
      node = node.children.get(char);
    }

    node.isEndOfWord = true;
    node.data.push(data);
    this.wordCount++;
  }

  /**
   * Insère plusieurs variantes d'un mot
   * (mot complet, mots individuels, préfixes)
   * 
   * @param {string} text - Texte complet (ex: "Gare de Périgueux")
   * @param {Object} data - Données associées
   */
  insertWithVariants(text, data) {
    // 1. Texte complet
    this.insert(text, data);

    // 2. Chaque mot individuellement
    const words = text.split(/\s+/);
    words.forEach(word => {
      if (word.length >= 2) {
        this.insert(word, data);
      }
    });

    // 3. Sans les mots courants (de, la, le, les, du, des)
    const withoutStopWords = text
      .replace(/\b(de|la|le|les|du|des|l'|d')\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    
    if (withoutStopWords !== text) {
      this.insert(withoutStopWords, data);
    }
  }

  /**
   * Recherche les mots commençant par un préfixe
   * 
   * @param {string} prefix - Préfixe à rechercher
   * @param {number} maxResults - Nombre max de résultats
   * @returns {Array<Object>} Données des mots trouvés
   */
  search(prefix, maxResults = 10) {
    const normalizedPrefix = this.normalize(prefix);
    if (!normalizedPrefix) return [];

    // Naviguer jusqu'au nœud du préfixe
    let node = this.root;
    for (const char of normalizedPrefix) {
      if (!node.children.has(char)) {
        return []; // Préfixe non trouvé
      }
      node = node.children.get(char);
    }

    // Collecter toutes les données sous ce nœud
    const results = [];
    this.collectAllData(node, results, maxResults);

    return results;
  }

  /**
   * Collecte récursivement les données d'un sous-arbre
   */
  collectAllData(node, results, maxResults) {
    if (results.length >= maxResults) return;

    // Ajouter les données de ce nœud s'il termine un mot
    if (node.isEndOfWord) {
      for (const data of node.data) {
        if (results.length >= maxResults) break;
        // Éviter les doublons (par ID)
        if (!results.some(r => r.id === data.id)) {
          results.push(data);
        }
      }
    }

    // Parcourir les enfants (ordre alphabétique pour cohérence)
    const sortedChildren = Array.from(node.children.entries()).sort((a, b) => 
      a[0].localeCompare(b[0])
    );

    for (const [char, childNode] of sortedChildren) {
      if (results.length >= maxResults) break;
      this.collectAllData(childNode, results, maxResults);
    }
  }

  /**
   * Vérifie si un mot exact existe
   * 
   * @param {string} word
   * @returns {boolean}
   */
  contains(word) {
    const normalizedWord = this.normalize(word);
    let node = this.root;

    for (const char of normalizedWord) {
      if (!node.children.has(char)) {
        return false;
      }
      node = node.children.get(char);
    }

    return node.isEndOfWord;
  }

  /**
   * Obtient le nombre de mots dans le Trie
   */
  size() {
    return this.wordCount;
  }

  /**
   * Vide le Trie
   */
  clear() {
    this.root = new TrieNode();
    this.wordCount = 0;
  }

  /**
   * Affiche des statistiques sur le Trie
   */
  stats() {
    const nodeCount = this.countNodes(this.root);
    return {
      words: this.wordCount,
      nodes: nodeCount,
      averageDepth: this.calculateAverageDepth(),
    };
  }

  countNodes(node) {
    let count = 1;
    for (const child of node.children.values()) {
      count += this.countNodes(child);
    }
    return count;
  }

  calculateAverageDepth() {
    const depths = [];
    this.collectDepths(this.root, 0, depths);
    if (depths.length === 0) return 0;
    return depths.reduce((a, b) => a + b, 0) / depths.length;
  }

  collectDepths(node, depth, depths) {
    if (node.isEndOfWord) {
      depths.push(depth);
    }
    for (const child of node.children.values()) {
      this.collectDepths(child, depth + 1, depths);
    }
  }
}

export default Trie;
