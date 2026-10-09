use std::{any::Any, collections::BTreeMap, sync::{Arc, Mutex}};
use keyring::credential::{Credential, CredentialApi, CredentialBuilderApi, CredentialPersistence};
#[derive(Clone, Default)]
pub struct MemoryKeyring {
    data: Arc<Mutex<BTreeMap<String, Vec<u8>>>>,
    pub fail_write: Arc<Mutex<Option<String>>>,
}
struct Entry { key: String, store: MemoryKeyring }
impl CredentialApi for Entry {
    fn set_secret(&self, value: &[u8]) -> keyring::Result<()> {
        if self.store.fail_write.lock().unwrap().as_deref() == Some(&self.key) { return Err(keyring::Error::NoEntry); }
        self.store.data.lock().unwrap().insert(self.key.clone(), value.to_vec()); Ok(())
    }
    fn get_secret(&self) -> keyring::Result<Vec<u8>> { self.store.data.lock().unwrap().get(&self.key).cloned().ok_or(keyring::Error::NoEntry) }
    fn delete_credential(&self) -> keyring::Result<()> { self.store.data.lock().unwrap().remove(&self.key); Ok(()) }
    fn as_any(&self) -> &dyn Any { self }
}
impl CredentialBuilderApi for MemoryKeyring {
    fn build(&self, _:Option<&str>, service:&str, user:&str) -> keyring::Result<Box<Credential>> {
        Ok(Box::new(Entry {key:format!("{service}:{user}"), store:self.clone()}))
    }
    fn as_any(&self) -> &dyn Any { self }
    fn persistence(&self) -> CredentialPersistence { CredentialPersistence::ProcessOnly }
}
