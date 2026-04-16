/**
 * LRU Cache - Limita o tamanho do cache automaticamente
 * Remove os itens menos usados quando atinge o limite
 */
class LRUCache {
  constructor(maxSize = 50) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key) {
    if (!this.cache.has(key)) {
      return null;
    }
    
    // Pega o valor
    const value = this.cache.get(key);
    
    // Move para o final (marca como recentemente usado)
    this.cache.delete(key);
    this.cache.set(key, value);
    
    return value;
  }

  set(key, value) {
    // Se já existe, remove para reordenar
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } 
    // Se atingiu o limite, remove o mais antigo
    else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
      console.log(`[LRU Cache] Removido item antigo: ${firstKey}`);
    }
    
    this.cache.set(key, value);
  }

  clear() {
    this.cache.clear();
  }

  size() {
    return this.cache.size;
  }

  has(key) {
    return this.cache.has(key);
  }

  delete(key) {
    return this.cache.delete(key);
  }
}
