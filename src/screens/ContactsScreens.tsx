import { BookUser, Plus, Trash2 } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { useNav } from '../nav';
import { shortAddress } from '../qoreWallet';
import { useTheme } from '../ThemeContext';
import { fonts, spacing } from '../theme';
import {
  Button,
  Card,
  dismissKeyboardAndWait,
  EmptyState,
  Eyebrow,
  IconBtn,
  ListRow,
  Notice,
  PushedScreen,
  Sheet,
  SheetTextInput,
} from '../ui';
import { getContacts, removeContact, saveContact } from '../walletStorage';

export function ContactAvatar({ name }: { name: string }) {
  const { colors } = useTheme();
  const initials = String(name || '?')
    .trim()
    .split(/\s+/)
    .map((word) => word[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <View
      style={{
        alignItems: 'center',
        backgroundColor: colors.accentSoft,
        borderRadius: 19,
        height: 38,
        justifyContent: 'center',
        width: 38,
      }}
    >
      <Text style={{ color: colors.accent, fontFamily: fonts.displaySemi, fontSize: 13 }}>
        {initials}
      </Text>
    </View>
  );
}

/** Bottom sheet: name a wallet address and save it. Keyboard-safe (Sheet pads). */
export function SaveContactSheet({ visible, onClose, address, initialName = '', onSaved }: any) {
  const { colors } = useTheme();
  const [name, setName] = useState(initialName);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (visible) {
      setName(initialName);
      setError('');
      setSaved(false);
    }
  }, [visible]);

  const save = async () => {
    setError('');
    await dismissKeyboardAndWait();
    try {
      await saveContact({ name, address });
      setSaved(true);
      onSaved?.();
      setTimeout(onClose, 900);
    } catch (caught: any) {
      setError(caught?.message || 'Could not save the contact.');
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <Eyebrow style={{ marginBottom: 10 }}>{saved ? 'Saved!' : 'Save contact'}</Eyebrow>
      {saved ? (
        <Text style={{ color: colors.positive, fontFamily: fonts.displaySemi, fontSize: 16, marginBottom: 10 }}>
          {name.trim()} added to contacts.
        </Text>
      ) : (
        <>
          <Card>
            <SheetTextInput
              style={{ color: colors.text, fontFamily: fonts.displaySemi, fontSize: 15, padding: 0 }}
              value={name}
              onChangeText={setName}
              placeholder="Name, e.g. “Alice”"
              placeholderTextColor={colors.faint}
              maxLength={32}
              onSubmitEditing={save}
              returnKeyType="done"
            />
          </Card>
          <Text
            style={{ color: colors.subtle, fontFamily: fonts.monoRegular, fontSize: 11.5, marginTop: 10 }}
            numberOfLines={1}
            ellipsizeMode="middle"
          >
            {address}
          </Text>
          {!!error && (
            <View style={{ marginTop: 12 }}>
              <Notice text={error} tone="error" />
            </View>
          )}
          <View style={{ gap: 10, marginTop: 14 }}>
            <Button label="Save" onPress={save} disabled={!name.trim()} />
            <Button label="Cancel" variant="secondary" onPress={onClose} />
          </View>
        </>
      )}
    </Sheet>
  );
}

/** Bottom sheet: pick a saved contact to prefill an address field. */
export function ContactPickerSheet({ visible, onClose, onSelect }: any) {
  const { colors } = useTheme();
  const [contacts, setContacts] = useState<any[]>([]);

  useEffect(() => {
    if (visible) getContacts().then(setContacts).catch(() => {});
  }, [visible]);

  return (
    <Sheet visible={visible} onClose={onClose}>
      <Eyebrow style={{ marginBottom: 10 }}>Contacts</Eyebrow>
      <Card pad={false}>
        {contacts.length === 0 ? (
          <EmptyState
            icon={<BookUser color={colors.accent} size={22} strokeWidth={2} />}
            title="No contacts yet"
            body="Save an address after a transfer, or add one from the side menu."
          />
        ) : (
          <ScrollView style={{ maxHeight: 420 }}>
            {contacts.map((contact, index) => (
              <ListRow
                key={contact.id}
                first={index === 0}
                leading={<ContactAvatar name={contact.name} />}
                title={contact.name}
                sub={shortAddress(contact.address, 12, 8)}
                onPress={() => {
                  onSelect(contact);
                  onClose();
                }}
              />
            ))}
          </ScrollView>
        )}
      </Card>
    </Sheet>
  );
}

export function ContactsScreen() {
  const { colors } = useTheme();
  const nav = useNav();
  const [contacts, setContacts] = useState<any[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [error, setError] = useState('');
  const [deleteFor, setDeleteFor] = useState<any>(null);

  const reload = () => getContacts().then(setContacts).catch(() => {});

  useEffect(() => {
    reload();
  }, []);

  const add = async () => {
    setError('');
    await dismissKeyboardAndWait();
    try {
      await saveContact({ name: newName, address: newAddress });
      setAddOpen(false);
      setNewName('');
      setNewAddress('');
      reload();
    } catch (caught: any) {
      setError(caught?.message || 'Could not save the contact.');
    }
  };

  const remove = async () => {
    if (!deleteFor) return;
    await removeContact(deleteFor.id);
    setDeleteFor(null);
    reload();
  };

  return (
    <PushedScreen
      title="Contacts"
      onBack={nav.pop}
      right={
        <IconBtn onPress={() => setAddOpen(true)}>
          <Plus color={colors.text} size={20} strokeWidth={2.2} />
        </IconBtn>
      }
    >
      <Card pad={false}>
        {contacts.length === 0 ? (
          <EmptyState
            icon={<BookUser color={colors.accent} size={22} strokeWidth={2} />}
            title="No contacts yet"
            body="Save addresses you send to often — they'll prefill on the send screen."
          />
        ) : (
          contacts.map((contact, index) => (
            <ListRow
              key={contact.id}
              first={index === 0}
              leading={<ContactAvatar name={contact.name} />}
              title={contact.name}
              sub={shortAddress(contact.address, 12, 8)}
              trailing={
                <IconBtn size={34} onPress={() => setDeleteFor(contact)}>
                  <Trash2 color={colors.negative} size={16} strokeWidth={2} />
                </IconBtn>
              }
            />
          ))
        )}
      </Card>

      {/* Add contact */}
      <Sheet visible={addOpen} onClose={() => setAddOpen(false)}>
        <Eyebrow style={{ marginBottom: 10 }}>New contact</Eyebrow>
        <Card>
          <SheetTextInput
            style={{ color: colors.text, fontFamily: fonts.displaySemi, fontSize: 15, padding: 0 }}
            value={newName}
            onChangeText={setNewName}
            placeholder="Name"
            placeholderTextColor={colors.faint}
            maxLength={32}
          />
        </Card>
        <View style={{ height: 10 }} />
        <Card>
          <SheetTextInput
            style={{ color: colors.text, fontFamily: fonts.monoRegular, fontSize: 13, padding: 0 }}
            value={newAddress}
            onChangeText={setNewAddress}
            placeholder="qor1… or 0x… address"
            placeholderTextColor={colors.faint}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </Card>
        {!!error && (
          <View style={{ marginTop: 12 }}>
            <Notice text={error} tone="error" />
          </View>
        )}
        <View style={{ gap: 10, marginTop: 14 }}>
          <Button label="Save contact" onPress={add} disabled={!newName.trim() || !newAddress.trim()} />
          <Button label="Cancel" variant="secondary" onPress={() => setAddOpen(false)} />
        </View>
      </Sheet>

      {/* Delete confirm */}
      <Sheet visible={Boolean(deleteFor)} onClose={() => setDeleteFor(null)}>
        {!!deleteFor && (
          <>
            <Text style={{ color: colors.text, fontFamily: fonts.display, fontSize: 17, marginBottom: 6, textAlign: 'center' }}>
              Remove {deleteFor.name}?
            </Text>
            <Text style={{ color: colors.subtle, fontSize: 13, marginBottom: 16, textAlign: 'center' }}>
              {shortAddress(deleteFor.address, 12, 8)}
            </Text>
            <View style={{ gap: 10 }}>
              <Button label="Remove" variant="danger" onPress={remove} />
              <Button label="Cancel" variant="secondary" onPress={() => setDeleteFor(null)} />
            </View>
          </>
        )}
      </Sheet>
    </PushedScreen>
  );
}
