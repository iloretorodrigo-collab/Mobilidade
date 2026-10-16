import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView,
  StatusBar, StyleSheet, Text, TextInput, View,
} from "react-native";
import * as SecureStore from "expo-secure-store";\nimport { WebView } from "react-native-webview";
import { authApi, API_URL, type AuthUser, type RouteEstimate } from "./src/api";

const TOKEN_KEY = "mobilidade.passenger.token";
const C = { ink: "#14211D", muted: "#6B7771", green: "#167A55", lime: "#D7FA75", paper: "#F5F7F3", white: "#FFFFFF", line: "#E2E8E1", red: "#B42318" };

export default function App() {
  const [mode, setMode] = useState<"login" | "register" | "forgot">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [verificationChannel, setVerificationChannel] = useState<"email" | "phone" | null>(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [profileName, setProfileName] = useState("");
  const [profilePhone, setProfilePhone] = useState("");
  const [originAddress, setOriginAddress] = useState("");
  const [destinationAddress, setDestinationAddress] = useState("");
  const [routeEstimate, setRouteEstimate] = useState<RouteEstimate | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const saved = await SecureStore.getItemAsync(TOKEN_KEY);
        if (saved) {
          const result = await authApi.me(saved);
          if (result.user.role === "passenger") { setToken(saved); setUser(result.user); }
          else await SecureStore.deleteItemAsync(TOKEN_KEY);
        }
      } catch { await SecureStore.deleteItemAsync(TOKEN_KEY); }
      finally { setLoading(false); }
    })();
  }, []);

  async function submit() {
    setError(""); setNotice("");
    if (!email.trim() || !email.includes("@")) return setError("Informe um e-mail válido.");
    if (mode === "register" && name.trim().length < 2) return setError("Informe seu nome completo.");
    if (mode !== "forgot" && password.length < 8) return setError("A senha deve ter pelo menos 8 caracteres.");
    setSubmitting(true);
    try {
      if (mode === "forgot") {
        if (!resetCode) {
          const result = await authApi.forgotPassword(email.trim().toLowerCase());
          setNotice(result.developmentCode ? "Código de desenvolvimento: " + result.developmentCode : result.message);
        } else {
          await authApi.resetPassword(email.trim().toLowerCase(), resetCode, password);
          setMode("login"); setResetCode(""); setPassword(""); setNotice("Senha redefinida. Entre com a nova senha.");
        }
        return;
      }
      const result = mode === "register"
        ? await authApi.register({ name: name.trim(), email: email.trim().toLowerCase(), phone: phone.trim() || undefined, password, role: "passenger" })
        : await authApi.login({ email: email.trim().toLowerCase(), password });
      if (result.user.role !== "passenger") throw new Error("Esta conta não é de passageiro. Use o aplicativo correspondente.");
      await SecureStore.setItemAsync(TOKEN_KEY, result.token);
      setToken(result.token); setUser(result.user); setPassword("");
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível entrar."); }
    finally { setSubmitting(false); }
  }

  useEffect(() => { if (user) { setProfileName(user.name); setProfilePhone(user.phone ?? ""); } }, [user]);

  async function startVerification(channel: "email" | "phone") {
    if (!token) return;
    try { const result = channel === "email" ? await authApi.requestEmailVerification(token) : await authApi.requestPhoneVerification(token); setVerificationChannel(channel); setVerificationCode(result.developmentCode ?? ""); setNotice(result.developmentCode ? "Código de desenvolvimento: " + result.developmentCode : result.message); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Não foi possível solicitar o código."); }
  }
  async function confirmVerification() {
    if (!token || !verificationChannel || verificationCode.length !== 6) return setError("Informe o código de 6 dígitos.");
    try { await authApi.confirmVerification(token, verificationChannel, verificationCode); const fresh = await authApi.me(token); setUser(fresh.user); setVerificationChannel(null); setVerificationCode(""); setNotice("Contato verificado com sucesso."); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Código inválido."); }
  }
  async function saveProfile() {
    if (!token) return;
    try { const result = await authApi.updateProfile(token, { name: profileName.trim(), phone: profilePhone.trim() || null }); setUser(result.user); setNotice("Perfil atualizado."); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Não foi possível atualizar o perfil."); }
  }

  async function calculateRoute() {
    setRouteError("");
    setRouteEstimate(null);
    if (originAddress.trim().length < 3 || destinationAddress.trim().length < 3) {
      setRouteError("Informe origem e destino com endereço, cidade e estado.");
      return;
    }
    setRouteLoading(true);
    try {
      const result = await authApi.estimateRoute(originAddress.trim(), destinationAddress.trim());
      setRouteEstimate(result);
    } catch (e) {
      setRouteError(e instanceof Error ? e.message : "Não foi possível calcular a rota.");
    } finally { setRouteLoading(false); }
  }

  async function logout() {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    setToken(null); setUser(null); setMode("login"); setNotice("Você saiu da sua conta.");
  }

  if (loading) return <View style={s.loading}><ActivityIndicator size="large" color={C.green}/><Text style={s.muted}>Preparando sua experiência...</Text></View>;

  if (user && token) return (
    <View style={s.page}>
      <StatusBar barStyle="dark-content" backgroundColor={C.paper}/>
      <ScrollView contentContainerStyle={s.dashboard}>
        <View style={s.topline}><Brand/><Pressable onPress={logout}><Text style={s.link}>Sair</Text></Pressable></View>
        <View style={s.hello}><Text style={s.eyebrow}>ÁREA DO PASSAGEIRO</Text><Text style={s.title}>Olá, {user.name.split(" ")[0]}.</Text><Text style={s.subtitle}>Sua próxima viagem começa aqui.</Text></View>
        <View style={s.rideCard}>
          <View style={s.rideIcon}><Text style={{fontSize:28}}>↗</Text></View>
          <Text style={s.cardTitle}>Para onde vamos?</Text>
          <Text style={s.cardText}>Sua conta está pronta. A solicitação de corridas será ativada na próxima etapa do projeto.</Text>
          <View style={s.disabledButton}><Text style={s.disabledButtonText}>Solicitar viagem · em breve</Text></View>
        </View>
        <View style={s.routeCard}>
          <View style={s.routeCardHeader}><View style={s.routeCardIcon}><Text style={{fontSize:22}}>⌖</Text></View><View style={{flex:1}}><Text style={s.routeCardTitle}>Calcule sua viagem</Text><Text style={s.routeCardSubtitle}>Rota de carro, distância, tempo e preço estimado.</Text></View></View>
          <Field label="ORIGEM" value={originAddress} onChangeText={setOriginAddress} placeholder="Rua, número, cidade - UF"/>
          <Field label="DESTINO" value={destinationAddress} onChangeText={setDestinationAddress} placeholder="Endereço de chegada, cidade - UF"/>
          <Pressable style={[s.primaryButton,routeLoading&&{opacity:0.7}]} onPress={calculateRoute} disabled={routeLoading}>
            {routeLoading?<ActivityIndicator color={C.ink}/>:<Text style={s.primaryText}>Calcular rota e preço ↗</Text>}
          </Pressable>
          {!!routeError && <Text accessibilityRole="alert" style={s.error}>{routeError}</Text>}
          {!!routeEstimate && <View style={s.estimatePanel}>
            <Text style={s.estimateLabel}>PREÇO ESTIMADO</Text>
            <Text style={s.estimatePrice}>{routeEstimate.estimatedFare.toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}</Text>
            <View style={s.estimateStats}><View style={{flex:1}}><Text style={s.estimateStatValue}>{routeEstimate.distanceKm.toLocaleString("pt-BR")} km</Text><Text style={s.estimateStatLabel}>Distância</Text></View><View style={{flex:1}}><Text style={s.estimateStatValue}>~{routeEstimate.durationMinutes} min</Text><Text style={s.estimateStatLabel}>Tempo de carro</Text></View></View>
            <View style={s.mapFrame}>
              <WebView originWhitelist={["*"]} source={{html: buildRouteMapHtml(routeEstimate)}} javaScriptEnabled domStorageEnabled style={s.mapView}/>
            </View>
            <Text style={s.estimateNote}>{routeEstimate.pricing.note}</Text>
            <Pressable style={s.mapButton} onPress={()=>Linking.openURL(routeEstimate.mapUrl)}><Text style={s.mapButtonText}>Ver rota no OpenStreetMap ↗</Text></Pressable>
            <Text style={s.mapAttribution}>Mapas: OpenStreetMap · Rotas: OSRM</Text>
          </View>}
        </View>
        <View style={s.profileCard}>
          <Text style={s.sectionLabel}>SEU PERFIL</Text>
          <Field label="NOME" value={profileName} onChangeText={setProfileName} placeholder="Seu nome" autoCapitalize="words"/><Info label="E-mail" value={user.email}/><Field label="TELEFONE" value={profilePhone} onChangeText={setProfilePhone} placeholder="+55..." keyboardType="phone-pad"/>
          <Pressable style={s.primaryButton} onPress={saveProfile}><Text style={s.primaryText}>Salvar perfil</Text></Pressable>
          <Text style={s.statusText}>E-mail: {user.emailVerified ? "verificado" : "não verificado"} · Telefone: {user.phoneVerified ? "verificado" : "não verificado"}</Text>
          <View style={{flexDirection:"row",gap:14,marginTop:12}}><Pressable onPress={()=>startVerification("email")}><Text style={s.link}>Verificar e-mail</Text></Pressable><Pressable onPress={()=>startVerification("phone")}><Text style={s.link}>Verificar telefone</Text></Pressable></View>
          {!!verificationChannel && <View style={{marginTop:12}}><Field label={"CÓDIGO DE " + verificationChannel.toUpperCase()} value={verificationCode} onChangeText={setVerificationCode} placeholder="6 dígitos" keyboardType="phone-pad"/><Pressable onPress={confirmVerification}><Text style={s.link}>Confirmar código</Text></Pressable></View>}
          {!!error && <Text style={s.error}>{error}</Text>}{!!notice && <Text style={s.notice}>{notice}</Text>}
        </View>
        <Text style={s.footer}>Mobilidade · Feita para mover você.</Text>
      </ScrollView>
    </View>
  );

  return (
    <View style={s.page}>
      <StatusBar barStyle="dark-content" backgroundColor={C.paper}/>
      <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={s.authScroll} keyboardShouldPersistTaps="handled">
          <View style={s.topline}><Brand/><View style={s.pill}><View style={s.pillDot}/><Text style={s.pillText}>PASSAGEIRO</Text></View></View>
          <View style={s.hero}>
            <View style={s.heroBadge}><Text style={s.heroBadgeText}>●  SUA CIDADE, NO SEU RITMO</Text></View>
            <Text style={s.heroTitle}>Chegue lá.{"\n"}Do seu jeito.</Text>
            <Text style={s.heroCopy}>Mobilidade simples, confortável e feita para a sua rotina.</Text>
            <View style={s.routeArt}>
              <View style={s.routeLine}/><View style={[s.routePoint,{top:20,left:28}]}/><View style={[s.routePoint,{bottom:20,right:30,backgroundColor:C.lime,borderColor:C.ink}]}/>
              <View style={s.mapLabel}><Text style={s.mapLabelSmall}>PRÓXIMA PARADA</Text><Text style={s.mapLabelBig}>Seu destino</Text></View>
              <Text style={s.arrowArt}>↗</Text>
            </View>
          </View>
          <View style={s.formCard}>
            <View style={s.switcher}>
              <Pressable style={[s.tab,mode==="login"&&s.tabActive]} onPress={()=>{setMode("login");setError("");setNotice("");}}><Text style={[s.tabText,mode==="login"&&s.tabTextActive]}>Entrar</Text></Pressable>
              <Pressable style={[s.tab,mode==="register"&&s.tabActive]} onPress={()=>{setMode("register");setError("");setNotice("");}}><Text style={[s.tabText,mode==="register"&&s.tabTextActive]}>Criar conta</Text></Pressable>
            </View>
            <Text style={s.formTitle}>{mode==="forgot"?"Recuperar senha":mode==="login"?"Que bom ter você de volta":"Vamos nessa?"}</Text>
            <Text style={s.formSubtitle}>{mode==="login"?"Entre para continuar sua jornada.":"Crie sua conta de passageiro em poucos passos."}</Text>
            {mode==="register" && <Field label="NOME COMPLETO" value={name} onChangeText={setName} placeholder="Como podemos te chamar?" autoCapitalize="words"/>}
            <Field label="E-MAIL" value={email} onChangeText={setEmail} placeholder="voce@exemplo.com" keyboardType="email-address" autoCapitalize="none"/>
            {mode==="register" && <Field label="TELEFONE (OPCIONAL)" value={phone} onChangeText={setPhone} placeholder="+55 (11) 99999-9999" keyboardType="phone-pad"/>}
            {mode==="forgot" && <Field label="CÓDIGO DE RECUPERAÇÃO" value={resetCode} onChangeText={setResetCode} placeholder="Código de 6 dígitos" keyboardType="phone-pad"/>}
            {mode!=="forgot" || !!resetCode ? <><Text style={s.fieldLabel}>{mode==="forgot"?"NOVA SENHA":"SENHA"}</Text>
            <View style={s.passwordRow}><TextInput style={s.passwordInput} value={password} onChangeText={setPassword} placeholder="Mínimo de 8 caracteres" placeholderTextColor="#9AA59E" secureTextEntry={!showPassword} autoCapitalize="none" autoCorrect={false}/><Pressable onPress={()=>setShowPassword(!showPassword)}><Text style={s.showText}>{showPassword?"Ocultar":"Mostrar"}</Text></Pressable></View></> : null}
            {mode==="register" && <Text style={s.hint}>Use pelo menos 8 caracteres.</Text>}
            {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
            {!!notice && <Text style={s.notice}>{notice}</Text>}
            {mode==="login" && <Pressable onPress={()=>{setMode("forgot");setError("");setNotice("");setResetCode("");}}><Text style={s.link}>Esqueci minha senha</Text></Pressable>}
            <Pressable style={[s.primaryButton,submitting&&{opacity:0.7}]} onPress={submit} disabled={submitting}>
              {submitting?<ActivityIndicator color={C.ink}/>:<Text style={s.primaryText}>{mode==="forgot"?(resetCode?"Redefinir senha":"Enviar código"):mode==="login"?"Entrar na minha conta":"Criar conta grátis"} <Text style={{fontSize:20}}>→</Text></Text>}
            </Pressable>
            <Text style={s.terms}>Ao continuar, você concorda com nossos termos de uso e política de privacidade.</Text>
            <Text style={s.apiNote}>API: {API_URL}</Text>
          </View>
          <Text style={s.footer}>MOBILIDADE © 2026 · MOVENDO O QUE IMPORTA</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function buildRouteMapHtml(estimate: RouteEstimate) {
  const route = estimate.routeCoordinates.map(([longitude, latitude]) => [latitude, longitude]);
  const start = [estimate.origin.latitude, estimate.origin.longitude];
  const end = [estimate.destination.latitude, estimate.destination.longitude];
  const coordinates = JSON.stringify(route.length > 1 ? route : [start, end]);
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"><style>html,body,#map{height:100%;width:100%;margin:0;padding:0;background:#eef2ea}.leaflet-control-attribution{font-size:9px}</style></head><body><div id="map"></div><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><script>const start=${JSON.stringify(start)};const end=${JSON.stringify(end)};const points=${coordinates};const map=L.map('map',{zoomControl:true,scrollWheelZoom:false}).setView(start,13);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);const line=L.polyline(points,{color:'#167A55',weight:5,opacity:.9}).addTo(map);L.marker(start).addTo(map).bindPopup('Origem');L.marker(end).addTo(map).bindPopup('Destino');map.fitBounds(line.getBounds(),{padding:[24,24]});setTimeout(()=>map.invalidateSize(),250);</script></body></html>`;
}

function Brand() { return <View style={s.brand}><View style={s.brandMark}><Text style={s.brandMarkText}>m</Text></View><Text style={s.brandName}>mobilidade<Text style={{color:C.green}}>.</Text></Text></View>; }
function Field(props: {label:string;value:string;onChangeText:(value:string)=>void;placeholder:string;keyboardType?:"default"|"email-address"|"phone-pad";autoCapitalize?:"none"|"sentences"|"words"|"characters"}) {
 return <View style={s.field}><Text style={s.fieldLabel}>{props.label}</Text><TextInput style={s.input} value={props.value} onChangeText={props.onChangeText} placeholder={props.placeholder} placeholderTextColor="#9AA59E" keyboardType={props.keyboardType??"default"} autoCapitalize={props.autoCapitalize??"sentences"} autoCorrect={false}/></View>;
}
function Info({label,value}:{label:string;value:string}) { return <View style={s.infoRow}><Text style={s.infoLabel}>{label}</Text><Text style={s.infoValue}>{value}</Text></View>; }

const s=StyleSheet.create({
 page:{flex:1,backgroundColor:C.paper},loading:{flex:1,backgroundColor:C.paper,alignItems:"center",justifyContent:"center",gap:12},muted:{color:C.muted,fontSize:14},
 authScroll:{paddingHorizontal:22,paddingTop:16,paddingBottom:30,maxWidth:620,width:"100%",alignSelf:"center"},topline:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",marginBottom:24},brand:{flexDirection:"row",alignItems:"center",gap:9},brandMark:{width:34,height:34,borderRadius:12,backgroundColor:C.green,alignItems:"center",justifyContent:"center"},brandMarkText:{color:C.lime,fontSize:25,fontWeight:"900",marginTop:-3},brandName:{fontSize:20,fontWeight:"800",letterSpacing:-0.8,color:C.ink},pill:{flexDirection:"row",alignItems:"center",gap:7,borderRadius:99,backgroundColor:"#E8F3E9",paddingHorizontal:12,paddingVertical:8},pillDot:{width:7,height:7,borderRadius:4,backgroundColor:C.green},pillText:{fontSize:10,fontWeight:"800",letterSpacing:1,color:C.green},
 hero:{paddingTop:5,paddingBottom:24},heroBadge:{alignSelf:"flex-start",backgroundColor:"#EAF1E7",paddingHorizontal:10,paddingVertical:7,borderRadius:7,marginBottom:14},heroBadgeText:{fontSize:9,fontWeight:"800",letterSpacing:1.1,color:C.green},heroTitle:{fontSize:43,lineHeight:47,fontWeight:"900",letterSpacing:-1.8,color:C.ink},heroCopy:{fontSize:14,lineHeight:21,color:C.muted,marginTop:10,maxWidth:300},routeArt:{height:92,borderRadius:18,backgroundColor:"#E9EEE5",marginTop:20,overflow:"hidden",justifyContent:"center"},routeLine:{position:"absolute",left:40,top:44,width:"72%",height:3,backgroundColor:"#A8BBA9",transform:[{rotate:"-8deg"}],borderRadius:2},routePoint:{position:"absolute",width:15,height:15,borderRadius:9,backgroundColor:C.green,borderWidth:3,borderColor:"#FFFFFF"},mapLabel:{position:"absolute",left:56,top:19},mapLabelSmall:{fontSize:8,fontWeight:"800",letterSpacing:1,color:C.muted},mapLabelBig:{fontSize:13,fontWeight:"800",color:C.ink,marginTop:3},arrowArt:{position:"absolute",right:22,top:18,fontSize:34,color:C.green,fontWeight:"300"},
 formCard:{backgroundColor:C.white,borderRadius:22,padding:20,borderWidth:1,borderColor:"#E8ECE6",shadowColor:"#14211D",shadowOpacity:0.04,shadowRadius:18,shadowOffset:{width:0,height:7},elevation:2},switcher:{flexDirection:"row",padding:4,borderRadius:12,backgroundColor:C.paper,marginBottom:21},tab:{flex:1,alignItems:"center",paddingVertical:11,borderRadius:9},tabActive:{backgroundColor:C.white,shadowColor:"#000",shadowOpacity:0.06,shadowRadius:5,elevation:1},tabText:{fontSize:13,fontWeight:"700",color:C.muted},tabTextActive:{color:C.ink},formTitle:{fontSize:23,fontWeight:"800",letterSpacing:-0.6,color:C.ink},formSubtitle:{fontSize:13,color:C.muted,marginTop:5,marginBottom:19,lineHeight:19},field:{marginBottom:14},fieldLabel:{fontSize:10,fontWeight:"800",letterSpacing:1,color:"#5E6D63",marginBottom:7},input:{height:49,borderWidth:1,borderColor:C.line,borderRadius:11,paddingHorizontal:13,fontSize:14,color:C.ink,backgroundColor:"#FCFDFC"},passwordRow:{height:49,borderWidth:1,borderColor:C.line,borderRadius:11,paddingLeft:13,paddingRight:12,flexDirection:"row",alignItems:"center",backgroundColor:"#FCFDFC"},passwordInput:{flex:1,fontSize:14,color:C.ink},showText:{fontSize:12,fontWeight:"700",color:C.green},hint:{fontSize:11,color:C.muted,marginTop:7},error:{color:C.red,fontSize:12,lineHeight:18,marginTop:12},notice:{color:C.green,fontSize:12,marginTop:12},primaryButton:{minHeight:52,marginTop:19,backgroundColor:C.lime,borderRadius:12,alignItems:"center",justifyContent:"center",paddingHorizontal:14},primaryText:{fontSize:14,fontWeight:"800",color:C.ink},terms:{fontSize:10,lineHeight:16,color:"#87928A",textAlign:"center",marginTop:14},apiNote:{fontSize:9,color:"#A0AAA2",textAlign:"center",marginTop:10},footer:{fontSize:9,letterSpacing:1.1,textAlign:"center",color:"#9AA59E",marginTop:22,fontWeight:"700"},
 dashboard:{paddingHorizontal:22,paddingTop:20,paddingBottom:40,maxWidth:620,width:"100%",alignSelf:"center"},link:{color:C.green,fontWeight:"800",fontSize:13},hello:{marginTop:18,marginBottom:23},eyebrow:{fontSize:10,letterSpacing:1.4,fontWeight:"800",color:C.green,marginBottom:10},title:{fontSize:34,fontWeight:"900",letterSpacing:-1,color:C.ink},subtitle:{fontSize:15,color:C.muted,marginTop:7},rideCard:{backgroundColor:C.ink,borderRadius:22,padding:22,marginBottom:16},rideIcon:{width:52,height:52,borderRadius:16,backgroundColor:C.lime,alignItems:"center",justifyContent:"center",marginBottom:22},cardTitle:{fontSize:23,fontWeight:"800",color:C.white,letterSpacing:-0.5},cardText:{fontSize:13,lineHeight:20,color:"#C6D1CA",marginTop:8},disabledButton:{marginTop:22,borderRadius:11,paddingVertical:14,alignItems:"center",backgroundColor:"#34443B"},disabledButtonText:{color:"#D8E0D9",fontSize:12,fontWeight:"800"},routeCard:{backgroundColor:C.white,borderRadius:20,padding:20,marginBottom:16,borderWidth:1,borderColor:C.line},routeCardHeader:{flexDirection:"row",alignItems:"center",gap:12,marginBottom:20},routeCardIcon:{width:44,height:44,borderRadius:14,backgroundColor:"#E8F3E9",alignItems:"center",justifyContent:"center"},routeCardTitle:{fontSize:20,fontWeight:"800",color:C.ink,letterSpacing:-0.4},routeCardSubtitle:{fontSize:12,lineHeight:18,color:C.muted,marginTop:4},estimatePanel:{marginTop:18,padding:16,borderRadius:14,backgroundColor:"#F3F7F0",borderWidth:1,borderColor:"#E0E9DC"},estimateLabel:{fontSize:9,fontWeight:"800",letterSpacing:1.2,color:C.green},estimatePrice:{fontSize:31,fontWeight:"900",letterSpacing:-0.8,color:C.ink,marginTop:5},estimateStats:{flexDirection:"row",gap:12,marginTop:16,paddingTop:14,borderTopWidth:1,borderTopColor:"#DFE8DB"},estimateStatValue:{fontSize:15,fontWeight:"800",color:C.ink},estimateStatLabel:{fontSize:10,color:C.muted,marginTop:4},estimateNote:{fontSize:10,lineHeight:15,color:C.muted,marginTop:14},mapFrame:{height:220,marginTop:16,borderRadius:12,overflow:"hidden",borderWidth:1,borderColor:C.line},mapView:{flex:1,backgroundColor:"#EEF2EA"},mapButton:{marginTop:14,backgroundColor:C.green,borderRadius:10,paddingVertical:13,alignItems:"center"},mapButtonText:{fontSize:12,fontWeight:"800",color:C.white},mapAttribution:{fontSize:9,color:C.muted,textAlign:"center",marginTop:9},profileCard:{backgroundColor:C.white,borderRadius:20,padding:20,borderWidth:1,borderColor:C.line},sectionLabel:{fontSize:10,fontWeight:"800",letterSpacing:1.3,color:C.muted,marginBottom:14},infoRow:{paddingVertical:12,borderBottomWidth:1,borderBottomColor:"#EFF2EE"},infoLabel:{fontSize:11,color:C.muted,marginBottom:5},infoValue:{fontSize:14,color:C.ink,fontWeight:"700"},status:{flexDirection:"row",alignItems:"center",gap:8,marginTop:16},dot:{width:8,height:8,borderRadius:4,backgroundColor:C.green},statusText:{fontSize:12,color:C.green,fontWeight:"700"}
});
