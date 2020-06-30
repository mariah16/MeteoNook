export enum DayType { NoData = 0, None, Shower, Rainbow, Aurora }
export enum ShowerType { NotSure = 0, Light, Heavy }

import {Hemisphere, Weather, SpecialDay, getMonthLength, Pattern, getPattern, getWeather, getWindPower, isSpecialDay, SnowLevel, CloudLevel, FogLevel, getSnowLevel, getCloudLevel, getFogLevel, checkWaterFog, RainbowInfo, getRainbowInfo, isAuroraPattern, fromLinearHour, toLinearHour, canHaveShootingStars, queryStars, getStarSecond, isLightShowerPattern, isHeavyShowerPattern, isPatternPossibleAtDate, GuessData, getPatternKind, PatternKind, SpWeatherLevel, getSpWeatherLevel, Constellation, getConstellation, getWindPowerMin, getWindPowerMax} from '../pkg'
export {Hemisphere, Weather, SpecialDay, getMonthLength}

export enum AmbiguousWeather {
	ClearOrSunny = 95,
	SunnyOrCloudy = 96,
	CloudyOrRainClouds = 97,
	NoRain = 98,
	RainOrHeavyRain = 99,
}

export interface WeatherTypeInfo {
	time: number, type: Weather|AmbiguousWeather
}
export interface StarInfo {
	hour: number, minute: number, seconds: number[]
}
export interface GapInfo {
	startHour: number, startMinute: number, endHour: number, endMinute: number
}

export interface DayInfo {
	y: number,
	m: number,
	d: number,
	dayType: DayType,
	showerType: ShowerType,
	rainbowTime: number,
	rainbowDouble: boolean,
	auroraFine01: boolean,
	auroraFine03: boolean,
	auroraFine05: boolean,
	types: WeatherTypeInfo[],
	stars: StarInfo[],
	gaps: GapInfo[]
}

export function createDayInfo(date: Date): DayInfo {
	return {
		y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate(),
		dayType: DayType.NoData, showerType: ShowerType.NotSure,
		rainbowTime: 10, rainbowDouble: false,
		auroraFine01: false, auroraFine03: false, auroraFine05: false,
		types: [], stars: [], gaps: []
	}
}

export function isDayNonEmpty(day: DayInfo): boolean {
	return (day.dayType != DayType.NoData || day.types.length > 0)
}
export function dayUsesTypes(day: DayInfo): boolean {
	const dt = day.dayType
	if (dt == DayType.NoData) return true
	if (dt == DayType.None) return true
	if (dt == DayType.Shower && day.showerType != ShowerType.Heavy) return true
	return false
}


export const firstPattern: Pattern = Pattern.Fine00
export const maxPattern: Pattern = Pattern.EventDay00

const patternNames: {[pat: number]: string} = {}
// this is horrible, but necessary
// because while TypeScript enums allow reverse lookups...
// the enums generated by wasm-bindgen are _not_ real TypeScript enums
for (const k of Object.keys(Pattern)) {
	patternNames[Pattern[k as any] as unknown as number] = k
}

export function getPatternName(pat: Pattern): string {
	return patternNames[pat]
}


function checkTypeMatch(realType: Weather, expected: Weather|AmbiguousWeather): boolean {
	switch (expected) {
		case AmbiguousWeather.ClearOrSunny:
			return realType == Weather.Clear || realType == Weather.Sunny
		case AmbiguousWeather.SunnyOrCloudy:
			return realType == Weather.Sunny || realType == Weather.Cloudy
		case AmbiguousWeather.CloudyOrRainClouds:
			return realType == Weather.Cloudy || realType == Weather.RainClouds
		case AmbiguousWeather.RainOrHeavyRain:
			return realType == Weather.Rain || realType == Weather.HeavyRain
		case AmbiguousWeather.NoRain:
			return !(realType == Weather.Rain || realType == Weather.HeavyRain)
		default:
			return realType == expected
	}
}
function checkPatternAgainstTypes(pat: Pattern, types: WeatherTypeInfo[]): boolean {
	for (const typeInfo of types) {
		if (checkTypeMatch(getWeather(typeInfo.time, pat), typeInfo.type) == false)
			return false
	}
	return true
}


export const rainbowPatternsByTime: {[hour: number]: Pattern} = {
	10: Pattern.CloudFine00,
	12: Pattern.CloudFine02,
	13: Pattern.CloudFine01,
	14: Pattern.FineRain00,
	15: Pattern.FineRain01,
	16: Pattern.FineRain03
}

export function getPossiblePatternsForDay(hemisphere: Hemisphere, day: DayInfo): Pattern[] {
	const results: Pattern[] = []

	for (let pat: Pattern = 0; pat <= maxPattern; pat++) {
		const isHeavy = isHeavyShowerPattern(pat)
		if (day.dayType == DayType.Shower) {
			// showers restrict patterns according to the specified shower type
			const isLight = isLightShowerPattern(pat)
			if (isLight && day.showerType == ShowerType.Heavy) continue
			if (isHeavy && day.showerType == ShowerType.Light) continue
			if (!isLight && !isHeavy) continue
		} else if (day.dayType == DayType.Rainbow) {
			// rainbows have one pattern determined by the rainbow time
			if (pat != rainbowPatternsByTime[day.rainbowTime]) continue
		} else if (day.dayType == DayType.Aurora) {
			// aurorae have three patterns, no easy way to distinguish
			// so we leave it to the user
			if (pat == Pattern.Fine01) {
				if (!day.auroraFine01) continue
			} else if (pat == Pattern.Fine03) {
				if (!day.auroraFine03) continue
			} else if (pat == Pattern.Fine05) {
				if (!day.auroraFine05) continue
			} else {
				continue
			}
		} else if (day.dayType == DayType.None) {
			// exclude heavy showers if 'None of the above' is selected
			// since they're pretty hard to miss
			if (isHeavy) continue
		}

		if (!isPatternPossibleAtDate(hemisphere, day.m, day.d, pat))
			continue

		if (dayUsesTypes(day) && !checkPatternAgainstTypes(pat, day.types))
			continue

		results.push(pat)
	}

	return results
}


export enum PopulateErrorKind {
	NoPatterns,
	StarConflict
}
export interface PopulateError {
	kind: PopulateErrorKind,
	hour?: number,
	minute?: number
}

export function populateGuessData(hemisphere: Hemisphere, data: GuessData, day: DayInfo): PopulateError | undefined {
	const patterns = getPossiblePatternsForDay(hemisphere, day)
	if (patterns.length == 0)
		return {kind: PopulateErrorKind.NoPatterns}

	for (const pattern of patterns) {
		data.addPattern(day.y, day.m, day.d, pattern)
	}

	if (day.dayType == DayType.Rainbow)
		data.addRainbow(day.y, day.m, day.d, day.rainbowDouble)

	if (day.dayType == DayType.Shower) {
		for (const star of day.stars) {
			data.addMinute(day.y, day.m, day.d, star.hour, star.minute, true)
			for (const second of star.seconds) {
				if (second != 99)
					data.addSecond(day.y, day.m, day.d, star.hour, star.minute, second)
			}
		}
		for (const gap of day.gaps) {
			const endLH = toLinearHour(gap.endHour)
			const endMinute = gap.endMinute
			for (let lh = toLinearHour(gap.startHour), minute = gap.startMinute; lh < endLH || (lh == endLH && minute <= endMinute); ) {
				const hour = fromLinearHour(lh)
				if (!data.addMinute(day.y, day.m, day.d, hour, minute, false)) {
					return {kind: PopulateErrorKind.StarConflict, hour, minute}
				}
				minute++
				if (minute == 60) {
					minute = 0
					lh++
				}
			}
		}
	}

	return undefined
}


export class IslandInfo {
	hemisphere: Hemisphere
	name: string
	seed: number
	offsetMinutes: number

	constructor(other?: IslandInfo|string) {
		if (other === undefined) {
			this.hemisphere = Hemisphere.Northern
			this.name = 'Anyisle'
			this.seed = 1856402561
			this.offsetMinutes = 0
		} else if (typeof other == 'string') {
			// parse query string
			const bits = other.split('&')
			this.name = decodeURIComponent(bits[1])
			this.seed = parseInt(decodeURIComponent(bits[2]), 10)
			this.hemisphere = (decodeURIComponent(bits[3]).toUpperCase() == 'S') ? Hemisphere.Southern : Hemisphere.Northern
			this.offsetMinutes = (bits[4] === undefined) ? 0 : parseInt(decodeURIComponent(bits[4]), 10)
		} else {
			// copy of existing IslandInfo
			this.hemisphere = other.hemisphere
			this.name = other.name
			this.seed = other.seed
			this.offsetMinutes = other.offsetMinutes
		}
	}

	get queryString(): string {
		const bits = ['?v1']
		bits.push(encodeURIComponent(this.name))
		bits.push(encodeURIComponent(this.seed.toString()))
		bits.push(encodeURIComponent((this.hemisphere == Hemisphere.Southern) ? 'S' : 'N'))
		if (this.offsetMinutes !== 0) {
			bits[0] = '?v2'
			bits.push(encodeURIComponent(this.offsetMinutes.toString()))
		}
		return bits.join('&')
	}

	static canLoadFromQueryString(str: string): boolean {
		const bits = str.split('&')
		if (bits.length === 4 && bits[0] === '?v1') return true
		if (bits.length === 5 && bits[0] === '?v2') return true
		return false
	}
}


export class Forecast {
	island: IslandInfo
	year: number
	month: number
	monthForecasts: MonthForecast[]

	get hemisphere(): Hemisphere { return this.island.hemisphere }
	get islandName(): string { return this.island.name }
	get seed(): number { return this.island.seed }

	constructor(island?: IslandInfo) {
		this.island = new IslandInfo(island)

		const now = new Date()
		now.setTime(now.getTime() - this.island.offsetMinutes * 60_000)
		this.year = now.getFullYear()
		this.month = now.getMonth() + 1
		this.monthForecasts = []
		this.regenerateForecasts()
	}

	setPreviousYear() {
		this.year -= 1
		this.regenerateForecasts()
	}
	setNextYear() {
		this.year += 1
		this.regenerateForecasts()
	}
	setPreviousMonth() {
		this.month -= 1
		if (this.month <= 0) {
			this.month = 12
			this.year -= 1
			this.regenerateForecasts()
		}
	}
	setNextMonth() {
		this.month += 1
		if (this.month >= 13) {
			this.month = 1
			this.year += 1
			this.regenerateForecasts()
		}
	}

	regenerateForecasts() {
		this.monthForecasts.splice(0, this.monthForecasts.length)
		for (let month = 1; month <= 12; month++) {
			const fc = new MonthForecast(this.hemisphere, this.seed, this.year, month)
			this.monthForecasts.push(Object.freeze(fc))
		}
	}

	get currentMonth(): MonthForecast {
		return this.monthForecasts[this.month - 1]
	}

	get hemiSuffix(): string {
		if (this.hemisphere == Hemisphere.Northern)
			return 'N'
		else
			return 'S'
	}

	get todayDate(): Date {
		// adjust back by 5 hours so the returned date
		// corresponds with the in-game 5am-5am days
		const now = new Date()
		now.setTime(now.getTime() + this.island.offsetMinutes * 60_000 - 5 * 3600_000)
		return now
	}
}


export class MonthForecast {
	readonly startDate: Date
	readonly days: DayForecast[]
	readonly auroraCount: number
	readonly rainbowCount: number
	readonly singleRainbowCount: number
	readonly doubleRainbowCount: number
	readonly lightShowerCount: number
	readonly heavyShowerCount: number

	constructor(
		readonly hemisphere: Hemisphere,
		readonly seed: number,
		readonly year: number,
		readonly month: number
	) {
		this.startDate = new Date(year, month - 1, 1)

		const dayCount = getMonthLength(year, month)
		this.days = []
		this.auroraCount = 0
		this.rainbowCount = 0
		this.singleRainbowCount = 0
		this.doubleRainbowCount = 0
		this.lightShowerCount = 0
		this.heavyShowerCount = 0

		for (let day = 1; day <= dayCount; day++) {
			const fc = new DayForecast(hemisphere, seed, year, month, day)
			this.days.push(fc)

			if (fc.aurora) this.auroraCount += 1
			if (fc.rainbowCount > 0) this.rainbowCount += 1
			if (fc.rainbowCount == 1) this.singleRainbowCount += 1
			if (fc.rainbowCount == 2) this.doubleRainbowCount += 1
			if (fc.lightShower) this.lightShowerCount += 1
			if (fc.heavyShower) this.heavyShowerCount += 1
		}
	}
}

const preNormalFogPatterns = [
	PatternKind.Fine,
	PatternKind.FineCloud, // I think?
	PatternKind.CloudFine,
	PatternKind.FineRain,
	PatternKind.EventDay
]
const preWaterFogPatterns = [
	PatternKind.Fine,
	PatternKind.FineCloud, // I think?
	PatternKind.CloudFine,
	PatternKind.FineRain
]
const fogPatterns = [
	PatternKind.Cloud,
	PatternKind.Rain,
	PatternKind.FineCloud,
	PatternKind.CloudFine,
	PatternKind.CloudRain,
	PatternKind.RainCloud // I think?
]

export class DayForecast {
	readonly patternPreviewMode: boolean
	readonly date: Date
	readonly pattern: Pattern
	readonly weather: Weather[]
	readonly windPower: number[]
	readonly windPowerMin: number[]
	readonly windPowerMax: number[]
	readonly constellation: Constellation
	readonly specialDay: SpecialDay
	readonly snowLevel: SnowLevel
	readonly spWeatherLevel: SpWeatherLevel
	readonly cloudLevel: CloudLevel
	readonly fogLevel: FogLevel
	readonly heavyFog: boolean
	readonly waterFog: boolean
	readonly rainbowCount: number
	readonly rainbowHour: number
	readonly aurora: boolean
	readonly lightShower: boolean
	readonly heavyShower: boolean
	readonly shootingStars: StarInfo[]

	get patternName(): string {
		return getPatternName(this.pattern)
	}

	hasAuroraAtHour(hour: number): boolean {
		if (this.aurora && this.weather[hour] == Weather.Clear) {
			return (hour <= 3) || (hour >= 18)
		}
		return false
	}
	hasStarsAtHour(hour: number): boolean {
		return canHaveShootingStars(hour, this.pattern)
	}

	get weekday(): number {
		return this.date.getDay()
	}

	constructor(
		readonly hemisphere: Hemisphere,
		readonly seed: number|null,
		readonly year: number,
		readonly month: number,
		readonly day: number,
		readonly forcedPattern?: Pattern
	) {
		this.date = new Date(year, month - 1, day)
		this.patternPreviewMode = (seed === null)

		let prevDay = day - 1, prevMonth = month, prevYear = year
		if (prevDay == 0) {
			prevMonth -= 1
			if (prevMonth == 0) {
				prevMonth = 12
				prevYear -= 1
			}
			prevDay = getMonthLength(prevYear, prevMonth)
		}

		// collect data from the library
		this.pattern = (forcedPattern === undefined) ? getPattern(hemisphere, seed!, year, month, day) : forcedPattern
		this.constellation = getConstellation(month, day)
		this.specialDay = isSpecialDay(hemisphere, year, month, day)
		this.snowLevel = getSnowLevel(hemisphere, month, day)
		this.spWeatherLevel = getSpWeatherLevel(hemisphere, month, day)
		this.cloudLevel = getCloudLevel(hemisphere, month, day)
		this.fogLevel = getFogLevel(hemisphere, month, day)
		this.aurora = isAuroraPattern(hemisphere, month, day, this.pattern)
		this.lightShower = isLightShowerPattern(this.pattern)
		this.heavyShower = isHeavyShowerPattern(this.pattern)

		const rainbow = getRainbowInfo(hemisphere, seed || 0, year, month, day, this.pattern)
		this.rainbowCount = Math.min(rainbow.count, (seed == null) ? 1 : 2)
		this.rainbowHour = rainbow.hour
		rainbow.free()

		this.weather = []
		this.windPower = []
		this.windPowerMin = []
		this.windPowerMax = []
		for (let hour = 0; hour < 24; hour++) {
			this.weather.push(getWeather(hour, this.pattern))
			this.windPowerMin.push(getWindPowerMin(hour, this.pattern))
			this.windPowerMax.push(getWindPowerMax(hour, this.pattern))
			if (seed !== null)
				this.windPower.push(getWindPower(seed, year, month, day, hour, this.pattern))
		}

		this.heavyFog = false
		this.waterFog = false
		this.shootingStars = []

		if (seed !== null) {
			const prevPattern = getPattern(hemisphere, seed, prevYear, prevMonth, prevDay)
			const prevKind = getPatternKind(prevPattern)
			const thisKind = getPatternKind(this.pattern)
			if (preNormalFogPatterns.includes(prevKind) && fogPatterns.includes(thisKind)) {
				this.heavyFog =
					(this.windPower[5] < 3) && (this.windPower[6] < 3) &&
					(this.windPower[7] < 3) && (this.windPower[8] < 3) &&
					this.fogLevel == FogLevel.HeavyAndWater
			}
			if (preWaterFogPatterns.includes(prevKind) && fogPatterns.includes(thisKind)) {
				this.waterFog =
					(this.fogLevel != FogLevel.None) &&
					checkWaterFog(seed, year, month, day)
			}

			for (let linearHour = 0; linearHour < 9; linearHour++) {
				const hour = fromLinearHour(linearHour)
				if (canHaveShootingStars(hour, this.pattern)) {
					for (let minute = 0; minute < 60; minute++) {
						const starCount = queryStars(seed, year, month, day, hour, minute, this.pattern)
						if (starCount > 0) {
							const star: StarInfo = {hour, minute, seconds: []}
							for (let i = 0; i < starCount; i++) {
								star.seconds.push(getStarSecond(i))
							}
							this.shootingStars.push(star)
						}
					}
				}
			}
		}
	}
}
