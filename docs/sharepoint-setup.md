# Klyo — konfiguracja SharePoint

Integracja jest przygotowana w aplikacji. Do pierwszego połączenia właściciel Klyo musi zarejestrować aplikację Microsoft Entra i dodać jej dane w Railway. Sama obecność zakładki Files nie oznacza aktywnego połączenia z Microsoft.

## 1. Zarejestruj aplikację

1. Zaloguj się do [Microsoft Entra admin center](https://entra.microsoft.com/) kontem służbowym z dostępem do swojej organizacji Microsoft 365.
2. Otwórz **Identity → Applications → App registrations → New registration**.
3. Nazwa: **Klyo CRM**.
4. Dla Klyo obsługującego różne firmy wybierz **Accounts in any organizational directory**. Jeśli wdrożenie ma obsługiwać wyłącznie Twoją firmę, możesz wybrać jeden tenant i podać jego identyfikator w konfiguracji.
5. Platforma przekierowania: **Web**. Dokładny adres produkcyjny:
   `https://klyolabs.com/api/sharepoint/callback`
6. Zapisz **Application (client) ID**. Dla konfiguracji jednej organizacji zapisz też **Directory (tenant) ID**.

## 2. Ustaw uprawnienia i sekret

W **API permissions → Add a permission → Microsoft Graph → Delegated permissions** dodaj:

- `Files.ReadWrite` — odczyt oraz zapisywanie plików w zakresie uprawnień zalogowanego użytkownika.
- `Sites.Read.All` — wyszukiwanie witryn i wybór biblioteki SharePoint.
- `offline_access` — odświeżanie połączenia bez logowania przy każdym pliku.

Nie dodawaj uprawnień typu Application ani `Sites.ReadWrite.All`. Administrator Microsoft 365 może wymagać zatwierdzenia dostępu zgodnie z polityką swojej organizacji. Zakres odczytu witryn jest szeroki; Klyo dodatkowo ogranicza przeglądanie i zapisy z CRM do folderu wybranego przez właściciela.

W **Certificates & secrets → New client secret** utwórz sekret, zapisz jego **Value** bezpośrednio do menedżera haseł lub Railway. Nie używaj identyfikatora sekretu zamiast jego wartości. Nie przesyłaj sekretu przez czat ani nie dodawaj do repozytorium. Zanotuj datę wygaśnięcia i wymień sekret przed tym terminem.

## 3. Dodaj zmienne w Railway

Otwórz usługę Klyo → **Variables**. Dodaj:

| Zmienna | Wartość |
| --- | --- |
| `MICROSOFT_CLIENT_ID` | Application (client) ID |
| `MICROSOFT_CLIENT_SECRET` | Wartość utworzonego sekretu |
| `MICROSOFT_TENANT_ID` | `organizations` dla wielu firm albo Directory (tenant) ID dla jednej firmy |
| `MICROSOFT_REDIRECT_URI` | `https://klyolabs.com/api/sharepoint/callback` |
| `INTEGRATION_ENCRYPTION_KEY` | Nowa, losowa, długa wartość przechowywana jako sekret; minimum 32 losowe bajty |

Sprawdź istniejącą `APP_URL`: musi wskazywać `https://klyolabs.com`. Zastosuj zmiany i poczekaj na zakończenie wdrożenia. Sekret oraz klucz szyfrowania działają wyłącznie na serwerze. Nie dodawaj ich do plików frontendu.

Nie zmieniaj klucza szyfrowania bez ponownego połączenia wszystkich integracji. Gdy `INTEGRATION_ENCRYPTION_KEY` nie jest ustawiony, aplikacja korzysta z `JWT_SECRET`; jego zmiana również wymaga ponownego połączenia.

## 4. Połącz konkretną przestrzeń

1. Otwórz Klyo → **Team → Files → Configure SharePoint** jako właściciel zespołu. W **Personal** konfigurujesz oddzielne połączenie widoczne tylko dla siebie.
2. Kliknij **Connect Microsoft**, zaloguj się i zaakceptuj wymagane uprawnienia.
3. Wyszukaj witrynę, wybierz bibliotekę dokumentów i folder. Zalecany jest osobny folder, np. **Klyo CRM**.
4. Kliknij **Use this folder for CRM files**.
5. Wgraj próbny plik, otwórz go, a następnie podłącz dokument do kontaktu albo oferty.

Członkowie zespołu mogą dodawać i podłączać pliki; użytkownicy z rolą Viewer mogą je przeglądać. Wyłącznie właściciel zespołu może zmienić połączenie i folder. Link do dokumentu otwierany w Microsoft nadal podlega uprawnieniom Microsoft 365 — członkowie zespołu powinni mieć dostęp do wybranej biblioteki. SharePoint w CRM jest współdzielony z zespołem poprzez konto podłączone przez właściciela; wybierz folder przeznaczony do wspólnej pracy.

## Co obsługuje integracja

- Ręczne wgrywanie plików do 250 MB, porcjami, ze wskazaniem postępu i ponowieniem nieudanego fragmentu.
- Podłączanie istniejących plików z wybranego folderu i jego podfolderów.
- Powiązanie pliku z kontaktem, firmą, transakcją, produktem lub ofertą.
- Import cenników CSV/XLSX do 10 MB bezpośrednio z SharePoint, z podglądem i zatwierdzeniem.
- Oddzielne połączenia i listy dokumentów dla Team i Personal.
- **Unlink** usuwa powiązanie w Klyo, zachowując plik w SharePoint. **Disconnect** zachowuje pliki i ich metadane, ale blokuje dostęp z CRM do ponownego połączenia właściwego folderu.

Po przekazaniu własności zespołu połączenie jest odłączane; nowy właściciel łączy swoje konto Microsoft i wybiera folder. Pliki pozostają w SharePoint. Nowe pliki otrzymują krótki losowy dopisek w nazwie, aby nie nadpisywać istniejących dokumentów.

Zmiana folderu przerywa rozpoczęte wgrywanie. Po zamknięciu okna wgrywania transfer zatrzymuje się po bieżącym fragmencie; nie jest wznawiany po przeładowaniu strony. Niedokończone sesje wygasają po stronie Microsoft. Rozmiary i dostępność nadal zależą od ograniczeń biblioteki oraz konta Microsoft 365. Integracja nie synchronizuje plików w tle i nie tworzy automatycznych wiadomości.

## Problemy

- **Microsoft sign-in has not been configured** — sprawdź `MICROSOFT_CLIENT_ID` i `MICROSOFT_CLIENT_SECRET`, a następnie wdrożenie Railway.
- **Redirect URI mismatch** — adres Web w Entra musi być identyczny z `MICROSOFT_REDIRECT_URI`, łącznie z HTTPS i ścieżką.
- **Need admin approval / brak witryn** — administrator Microsoft musi zatwierdzić uprawnienia i zapewnić kontu dostęp do witryny.
- **Reconnect your Microsoft account** — połączenie wygasło albo uprawnienia zostały cofnięte. Wybierz Reconnect Microsoft i ponownie wskaż folder.
- **This item is outside the connected CRM folder** — wybierz dokument we wskazanym folderze lub jego podfolderze.

Dokumentacja Microsoft: [rejestracja aplikacji](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app), [logowanie z kodem autoryzacyjnym](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow), [sesje wgrywania](https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession?view=graph-rest-1.0), [wyszukiwanie witryn](https://learn.microsoft.com/en-us/graph/api/site-search?view=graph-rest-1.0).
