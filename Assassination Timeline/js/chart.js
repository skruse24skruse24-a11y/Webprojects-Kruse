var options;
var dataTable;
var chart;
var prevButton, nextButton;
var navButtons = [];
var currentIndex = 0;
var zoomed = false;

var ranges = [
    { min: 1450, max: 2025 },
    { min: -1975, max: -1955 },
    { min: 215, max: 280 },
    { min: 845, max: 905 },
    { min: 1145, max: 1175 },
    { min: 1570, max: 1630 },
    { min: 1845, max: 1885 },
    { min: 1900, max: 1960 },
    { min: 1955, max: 2025 },
    { min: 1955, max: 2025 }
];

google.charts.load("current", { 'packages': ['corechart', 'bar', 'gantt'] });
google.charts.setOnLoadCallback(init);

function setButtonsEnabled(enabled) {
    if (prevButton) prevButton.disabled = !enabled;
    if (nextButton) nextButton.disabled = !enabled;
    navButtons.forEach(function (b) { b.disabled = !enabled; });
}

function updateDataStyling() {
    var numRows = dataTable.getNumberOfRows();
    for (var i = 0; i < numRows; i++) {
        var year = dataTable.getValue(i, 0);
        var detailsHTML = dataTable.getValue(i, 3);
        var hasDetailedTooltip = detailsHTML && detailsHTML.indexOf('radial2') !== -1;

        var barStyle;
        if (currentIndex === 0) {
            barStyle = 'fill-color: #B85858; stroke-color: #B85858; stroke-width: 1';
        } else {
            barStyle = hasDetailedTooltip ? 'fill-color: #B85858; stroke-color: #B85858; stroke-width: 1' : 'fill-color: #cccccc; stroke-color: #cccccc; stroke-width: 1';
        }

        dataTable.setValue(i, 2, barStyle);
    }
}

function drawChartWithView() {
    adjustVAxisToData();
    options.hAxis.ticks = generateFormattedTicks();
    updateDataStyling();

    if (currentIndex === 0) {
        options.tooltip = { trigger: 'none' };
        options.focusTarget = 'category';
        document.body.classList.add('thick-bars');
        options.hAxis.gridlines.color = '#D0A0A0';
    } else {
        options.tooltip = { isHtml: true, trigger: 'selection' };
        options.focusTarget = 'datum';
        document.body.classList.remove('thick-bars');
        options.hAxis.gridlines.color = '#A85050';
    }

    var view = new google.visualization.DataView(dataTable);
    view.setColumns([0, 1, 2, 3]);
    chart.draw(view, options);
}

function init() {
    options = {
        backgroundColor: 'transparent',
        chartArea: {
            top: 0,
            width: '100%',
            height: '95%',
            bottom: 30,
            backgroundColor: 'transparent'
        },
        tooltip: {
            isHtml: true,
            trigger: 'selection'
        },
        focusTarget: 'datum',
        dataOpacity: 1.0,
        legend: { position: "none" },
        animation: { duration: 1000, easing: 'out' },
        axisTitlesPosition: 'out',
        bar: { groupWidth: '100%' },
        annotations: {
            textStyle: {
                fontName: 'Arial',
                fontSize: 12,
                bold: true,
                italic: false,
                color: 'black'
            },
            alwaysOutside: true,
            stem: {
                color: 'transparent',
                length: 12
            }
        },
        hAxis: {
            viewWindow: { min: ranges[0].min, max: ranges[0].max },
            textPosition: 'out',
            textStyle: {
                color: '#711919',
                fontSize: 16,
                fontName: 'Girassol'
            },
            titleTextStyle: {
                color: '#711919'
            },
            gridlines: {
                count: -1,
                color: '#A85050'
            },
            minorGridlines: {
                count: 0
            }
        },
        vAxis: {
            textStyle: {
                color: '#711919',
                fontSize: 16,
                fontName: 'Girassol'
            },
            titleTextStyle: {
                color: '#711919'
            },
            gridlines: {
                count: 5,
                interval: 1,
                minspacing: 10,
                color: '#A85050'
            },
            textPosition: 'in',
        },
    };

    prevButton = document.getElementById('prevBtn');
    nextButton = document.getElementById('nextBtn');
    navButtons = Array.prototype.slice.call(document.querySelectorAll('.optBtn'));

    function calculateAnimationDuration(fromIndex, toIndex) {
        if (fromIndex === 0 || toIndex === 0) {
            if ((fromIndex === 0 && toIndex === 1) || (fromIndex === 1 && toIndex === 0)) {
                return { duration: 4000, easing: 'inAndOut' };
            }
            return { duration: 1800, easing: 'out' };
        }

        var fromRange = ranges[fromIndex];
        var toRange = ranges[toIndex];
        var fromCenter = (fromRange.min + fromRange.max) / 2;
        var toCenter = (toRange.min + toRange.max) / 2;
        var distance = Math.abs(toCenter - fromCenter);
        var baseDuration = Math.min(3600, Math.max(1200, distance / 50 + 800));

        return { duration: Math.round(baseDuration), easing: 'out' };
    }

    setRangeIndex(currentIndex);

    navButtons.forEach(function (b, i) {
        b.addEventListener('click', function () {
            options.animation = calculateAnimationDuration(currentIndex, i);
            setRangeIndex(i);
            redraw();
        });
    });

    prevButton.addEventListener('click', function () {
        if (currentIndex > 0) {
            var newIndex = currentIndex - 1;
            options.animation = calculateAnimationDuration(currentIndex, newIndex);
            currentIndex = newIndex;
            setRangeIndex(currentIndex);
            redraw();
        }
    });

    nextButton.addEventListener('click', function () {
        if (currentIndex < ranges.length - 1) {
            var newIndex = currentIndex + 1;
            options.animation = calculateAnimationDuration(currentIndex, newIndex);
            currentIndex = newIndex;
            setRangeIndex(currentIndex);
            redraw();
        }
    });

    drawChart();
}

function drawChart() {
    dataTable = new google.visualization.DataTable();

    dataTable.addColumn('number', 'Year');
    dataTable.addColumn('number', 'Value');
    dataTable.addColumn({ type: 'string', role: 'style' });
    dataTable.addColumn({ type: 'string', role: 'tooltip', p: { html: true } });

    var rawData = [
        [-1962, 1, '<div class="radial2" id="Ahen"><img class="photo" src="img/Title.svg"><div><img src=img/stabbed.svg><span class="name">Pharaoh Amenemhat I</span></div> - Founder of Egypt\'s Twelfth Dynasty (1991-1962 BCE). Established a new capital at Itjtawy and centralized power after years of civil war. According to the "Instructions of Amenemhat," he was assassinated in his bedchamber by members of his own bodyguard during a palace coup. The text, allegedly written by Amenemhat himself, describes his murder and serves as the first recorded political assassination in history. His son Senusret I immediately secured the succession, but the identity and motives of the assassins remain unknown. This assassination became a cautionary tale about trust and palace intrigue for future Egyptian rulers.</div>', 'Amenemhat I'],
        [193, 2],
        [222, 1, '<div class="radial2"><div><img src=img/stabbed.svg><span class="name">Emperor Elagabalus</span></div> - Roman Emperor (218-222 CE) who became emperor at age 14. Born Varius Avitus Bassianus, he took the name Elagabalus after the Syrian sun god he served as high priest. His reign was marked by religious controversy as he attempted to replace Jupiter with Elagabalus as Rome\'s chief deity, and by scandalous behavior that offended Roman sensibilities. By 222 CE, his grandmother Julia Maesa decided he had become a liability and orchestrated a conspiracy to replace him with his cousin Alexander Severus. On March 11, 222 CE, the Praetorian Guard assassinated the 18-year-old emperor and his mother in the Praetorian camp. Both bodies were dragged through Rome\'s streets and thrown into the Tiber River.</div>', 'Elagabalus'],
        [238, 3, '<div class="radial2"><div><img src=img/stabbed.svg><span class="name">Emperor Balbinus</span></div> - Roman Emperor who ruled jointly with Pupienus for only 99 days in 238 CE during the chaotic "Year of the Six Emperors." Balbinus, a wealthy aristocrat, and Pupienus, a military commander, were appointed co-emperors by the Senate after the deaths of Gordian I and II. However, they distrusted each other and failed to work together effectively. The Praetorian Guard, angry at being excluded from the selection process and receiving no bonus payment, resented both emperors. On July 29, 238 CE, Praetorian soldiers stormed the imperial palace, dragged both co-emperors through the streets, and brutally murdered them. The Guard then proclaimed the teenage Gordian III as sole emperor.</div>', 'Balbinus'],
        [275, 1, '<div class="radial2"><div><img src=img/stabbed.svg><span class="name">Emperor Aurelian</span></div> - Roman Emperor (270-275 CE), known as "Restitutor Orbis" (Restorer of the World) for reunifying the fractured Roman Empire during the Crisis of the Third Century. A brilliant military commander of humble origins, Aurelian defeated the Palmyrene Empire in the East and the Gallic Empire in the West, restoring imperial unity. He also constructed the Aurelian Walls around Rome. In September 275 CE, while marching to campaign in Persia, Aurelian was assassinated near Caenophrurium (modern Turkey). The conspiracy resulted from his secretary Eros forging a list claiming Aurelian planned to execute several officers. These officers, believing their lives in danger, murdered the emperor. When the forgery was discovered, the conspirators were killed by loyal soldiers.</div>', 'Aurelian'],
        [293, 1],
        [882, 1, '<div class="radial2"><div><img src=img/poison.svg><span class="name">Pope John VIII</span></div> - Pope from 872-882 CE during a turbulent period marked by Muslim Saracen raids, political intrigue, and conflicts with the Eastern Church. John VIII was an active pope who personally led negotiations with various powers and organized naval forces against Saracen invasions. On December 16, 882 CE, he became the first pope to be assassinated. According to medieval sources, he was poisoned by members of his own entourage, reportedly relatives seeking to benefit from his death. When the poison worked too slowly, they finished him off by clubbing him to death with a hammer. His death came after he had excommunicated several powerful nobles, creating many enemies. The exact details remain unclear due to the chaotic nature of the era.</div>', 'Pope John VIII'],
        [1044, 2],
        [1156, 1, '<div class="radial2"><div><img src=img/stabbed.svg><span class="name">King Sverker I of Sweden</span></div> - King of Sweden (c. 1130-1156), founder of the House of Sverker which would alternate power with the rival House of Eric for over a century. Sverker I married the widow of his predecessor King Inge the Younger, allowing him to claim the throne. His reign saw the establishment of the first Swedish bishopric and efforts to strengthen Christianity in Sweden. However, his rule was contested and created lasting political divisions. On December 25, 1156 (Christmas Day), King Sverker I was assassinated at Alvastra in Ostergotland by a servant or retainer. The exact circumstances and motives remain unclear, though some sources suggest political connections to the rival Eric clan. His death sparked over a century of civil conflict between the Sverkers and Erics.</div>', 'Sverker I'],
        [1160, 2, '<div class="radial2"><div><img src=img/stabbed.svg><span class="name">King Eric IX of Sweden (Saint Eric)</span></div> - King of Sweden (c. 1156-1160) who succeeded Sverker I after his assassination. Eric IX, later canonized as Saint Eric and patron saint of Sweden, attempted to consolidate royal power and spread Christianity. He is credited with organizing the First Swedish Crusade to Finland to convert the Finns to Christianity. His brief reign was marked by religious zeal and political opposition from supporters of the Sverker dynasty. On May 18, 1160 (Ascension Day), Eric IX was attending Mass at the Old Church of Uppsala when he was attacked by a Danish army led by Magnus Henriksen, supported by Sverker\'s sons. According to legend, Eric asked to finish hearing Mass before facing his attackers. He was killed outside the church, and his death led to his veneration as a martyr and saint.</div>', 'Eric IX'],
        [1167, 1, '<div class="radial2"><div><img src=img/stabbed.svg><span class="name">King Charles VII of Sweden</span></div> - King of Sweden (1161-1167), also known as Karl Sverkersson, son of the assassinated King Sverker I. Charles VII represented the Sverker dynasty in the ongoing civil war against the House of Eric. After his father\'s murder and Eric IX\'s brief reign, Charles managed to seize the throne in 1161. His reign was marked by constant conflict with supporters of the Eric dynasty, particularly Knut Eriksson (son of Eric IX). On April 12, 1167, Charles VII was ambushed and killed at Visingso by supporters of Knut Eriksson, allowing Knut to claim the throne as Canute I. Charles VII\'s death continued the bloody cycle of revenge killings between the two dynasties, with civil wars persisting until the extinction of the Sverker line in 1222.</div>', 'Charles VII'],
        [1577, 1, '<div class="radial2"><div><img src=img/poison.svg><span class="name">King Eric XIV of Sweden</span></div> - King of Sweden (1560-1568), son of Gustav Vasa who founded modern Sweden. Eric XIV was intelligent and cultured but increasingly paranoid and mentally unstable. His reign saw military conflicts with Denmark, Poland, and Lubeck in the Northern Seven Years\' War. In 1567, Eric\'s paranoia peaked with the "Sture Murders," where he personally participated in killing several imprisoned nobles he suspected of treason. His erratic behavior turned the nobility against him, and in 1568, his half-brothers Duke John and Duke Charles led a rebellion that deposed him. Eric was imprisoned for nine years. On February 26, 1577, while imprisoned at Orbyhus Castle, the 43-year-old former king died suddenly. Most historians believe he was poisoned on orders of his half-brother King John III, possibly with arsenic in his pea soup.</div>', 'Eric XIV'],
        [1605, 1, '<div class="radial2"><div><img src=img/poison.svg><span class="name">Tsar Feodor II of Russia</span></div> - Tsar of Russia for only 45 days in 1605, the teenage son of Boris Godunov. Feodor II became tsar at age 16 when his father Boris died suddenly on April 13, 1605, amid a civil war against the False Dmitry I, who claimed to be the supposedly murdered son of Ivan the Terrible. Young Feodor was intelligent and well-educated but had no time to establish his rule. The False Dmitry\'s forces, supported by Polish troops and Russian boyars who opposed the Godunov family, advanced on Moscow. On June 10, 1605, after only 45 days of reign, conspirators led by boyars arrested Feodor II, his mother, and his sister. The official announcement claimed they had poisoned themselves, but in reality, the entire family was murdered to eliminate any Godunov claim to the throne.</div>', 'Theodore II'],
        [1856, 1, '<div class="radial2"><div><img src=img/shot.svg><span class="name">James Strang</span></div> - Self-proclaimed king and leader of his own Mormon sect (Strangites) on Beaver Island, Michigan. Three men who opposed Strang formed a plot to kill him, led by McCulloch, a former friend. They allied with Captain Charles H. McBlair of USS Michigan, who docked at Beaver Island and summoned Strang to board the ship. When Strang prepared to board, Bedford and Wentworth emerged from behind stacks of cordwood and shot Strang twice in the back of the head. After he fell, they shot him once more in the back and struck him in the face with their guns. They fled aboard USS Michigan with their families to Mackinac County, where their actions were celebrated. They were briefly jailed but the doors were left unlocked and no investigation occurred. Strang died from his wounds weeks later.</div>', 'James Strang'],
        [1865, 5, '<div class="radial2"><div><img src=img/shot.svg><span class="name">President Abraham Lincoln</span></div> - 16th President of the United States who led the nation through the Civil War and abolished slavery. On April 14, 1865, just days after the Confederate surrender, Lincoln attended a performance of "Our American Cousin" at Ford\'s Theatre in Washington, D.C. At approximately 10:15 pm, actor and Confederate sympathizer John Wilkes Booth entered the presidential box and shot Lincoln in the back of the head with a .44 caliber Derringer pistol. Booth jumped to the stage, shouted "Sic semper tyrannis!" ("Thus always to tyrants"), and escaped. Lincoln was carried across the street to the Petersen House, where he died the following morning at 7:22 am on April 15, 1865. He was the first U.S. president to be assassinated. Booth was tracked down and killed 12 days later.</div>', 'Abraham Lincoln'],
        [1867, 3],
        [1868, 13],
        [1869, 5],
        [1870, 8],
        [1876, 2, '<div class="radial2"><div><img src=img/shot.svg><span class="name">Alfred Rush</span></div> - South Carolina state representative and African American Republican politician during the violent end of Reconstruction. Rush represented Florence County in the state legislature and was active in organizing Black voters and supporting civil rights. The 1876 election year was particularly violent in South Carolina, with white supremacist "Red Shirts" paramilitary groups terrorizing Black voters and Republican politicians. On October 16, 1876, Rush and his wife Aggy were returning home from a Republican campaign picnic when they stopped at a creek crossing to let their horses drink. A gunshot rang out from ambush, striking Rush directly in the heart and killing him instantly. William D. Purvis, a white neighbor, was arrested and tried for the assassination, but an all-white jury acquitted him despite evidence. Rush\'s murder was one of many political assassinations during the 1876 campaign that ended Reconstruction through terror.</div>', 'Alfred Rush'],
        [1879, 1],
        [1882, 5],
        [1891, 1],
        [1901, 1, '<div class="radial2"><div><img src=img/shot.svg><span class="name">President William McKinley</span></div> - 25th President of the United States. On September 6, 1901, McKinley was shot twice by anarchist Leon Czolgosz while greeting the public at the Temple of Music at the Pan-American Exposition in Buffalo, New York. One bullet deflected off a button, but the other penetrated his abdomen. Despite initial optimism, gangrene set in around his wounds. McKinley died on September 14, 1901 at 2:15 am, becoming the third U.S. president to be assassinated. His death led to Theodore Roosevelt\'s presidency and prompted Congress to officially charge the Secret Service with presidential protection.</div>', 'McKinley'],
        [1914, 7, '<div class="radial2"><div><img src=img/bombed.svg><span class="name">Archduke Franz Ferdinand and Sophie</span></div> - Heir presumptive to the Austro-Hungarian throne and his wife. On June 28, 1914, the couple were assassinated in Sarajevo by Gavrilo Princip, a 19-year-old Bosnian Serb member of the Black Hand secret society. After an initial failed bombing attempt by another conspirator, Princip shot Franz Ferdinand in the neck and Sophie in the abdomen. Both died within the hour. This assassination triggered a chain of events leading to World War I, as Austria-Hungary issued an ultimatum to Serbia, leading to declarations of war across Europe.</div>', 'Franz Ferdinand'],
        [1940, 11, '<div class="radial2"><div><img src=img/stabbed.svg><span class="name">Leon Trotsky</span></div> - Marxist revolutionary and Soviet politician, founder of the Red Army and Lenin\'s ally. Exiled by Stalin in 1929, Trotsky lived in Mexico City where he continued writing and organizing opposition to Stalin\'s regime. On August 20, 1940, NKVD agent Ramon Mercader, posing as "Frank Jacson," gained access to Trotsky\'s study and attacked him with an ice axe, striking him in the head. Trotsky fought back and called for help, surviving long enough to tell guards, "I will not survive this attack." He died the following day, August 21, 1940. His assassination was ordered by Stalin as part of his campaign to eliminate all potential rivals. An estimated 300,000 people attended Trotsky\'s funeral in Mexico City.</div>', 'Leon Trotsky'],
        [1948, 13, '<div class="radial2"><div><img src=img/shot.svg><span class="name">Mahatma Gandhi</span></div> - Leader of the Indian independence movement and pioneer of nonviolent civil disobedience (satyagraha). Gandhi led India\'s struggle for independence from British rule through peaceful resistance and civil disobedience campaigns. On January 30, 1948, Gandhi was assassinated at Birla House in New Delhi by Nathuram Godse, a Hindu nationalist who opposed Gandhi\'s support for India\'s Muslims during the partition. At 5:17 pm, as Gandhi walked to a prayer meeting, Godse fired three shots at point-blank range, striking Gandhi in the chest. His last words were reportedly "He Ram" ("Oh God"). Gandhi\'s death led to massive mourning across India, with over a million people attending his funeral procession. His philosophy of nonviolent resistance inspired civil rights movements worldwide, including Martin Luther King Jr.\'s campaign.</div>', 'Gandhi'],
        [1963, 15, '<div class="radial2"><div><img src=img/shot.svg><span class="name">President John F. Kennedy</span></div> - 35th President of the United States, known for his charismatic leadership during the Cold War, civil rights advocacy, and space program initiatives. On November 22, 1963, Kennedy was assassinated while riding in a presidential motorcade through Dealey Plaza in Dallas, Texas. At 12:30 pm, shots rang out and Kennedy was struck twice - once in the upper back and once in the head. He was pronounced dead at Parkland Memorial Hospital at 1:00 pm. Lee Harvey Oswald was arrested for the murder but was himself shot and killed two days later by nightclub owner Jack Ruby. The Warren Commission concluded Oswald acted alone, but the assassination has spawned numerous conspiracy theories. Kennedy\'s death shocked the nation and world, with his state funeral attended by representatives from over 90 countries.</div>', 'JFK'],
        [1965, 23, '<div class="radial2"><div><img src=img/shot.svg><span class="name">Malcolm X</span></div> - Influential African-American Muslim minister, human rights activist, and prominent figure in the civil rights movement. Born Malcolm Little, he became a controversial spokesman for the Nation of Islam before breaking away and embracing mainstream Islam. His advocacy for Black nationalism and self-defense made him a polarizing figure. On February 21, 1965, while preparing to address the Organization of Afro-American Unity at the Audubon Ballroom in Manhattan, Malcolm X was shot multiple times by three gunmen. He sustained 21 gunshot wounds and was pronounced dead at Columbia Presbyterian Hospital. Talmadge Hayer was arrested at the scene; two other men were later convicted, though they maintained their innocence. Between 14,000 and 30,000 mourners attended his funeral. His assassination remains controversial, with ongoing questions about the full extent of the conspiracy.</div>', 'Malcolm X'],
        [1968, 9, '<div class="radial2"><div><img src=img/shot.svg><span class="name">Dr. Martin Luther King Jr.</span></div> - Baptist minister and leader of the American civil rights movement, Nobel Peace Prize laureate known for his philosophy of nonviolent resistance. King led landmark civil rights campaigns including the Montgomery Bus Boycott and March on Washington, where he delivered his famous "I Have a Dream" speech. On April 4, 1968, King was assassinated at the Lorraine Motel in Memphis, Tennessee, where he was supporting striking sanitation workers. At 6:01 pm, while standing on the motel\'s second-floor balcony, King was shot in the face by James Earl Ray firing from a nearby boarding house. He was rushed to St. Joseph\'s Hospital and pronounced dead at 7:05 pm. The day before, King had delivered his prophetic "I\'ve Been to the Mountaintop" speech. His assassination sparked riots in over 100 American cities and led to a national day of mourning.</div>', 'MLK Jr.'],
        [1968, 9, '<div class="radial2"><div><img src=img/shot.svg><span class="name">Senator Robert F. Kennedy</span></div> - U.S. Senator from New York, former Attorney General, and 1968 Democratic presidential candidate. Brother of President John F. Kennedy and champion of civil rights and social justice. On June 5, 1968, shortly after midnight, Kennedy was shot at the Ambassador Hotel in Los Angeles moments after delivering his victory speech for winning the California Democratic primary. As he walked through the hotel\'s kitchen pantry, Sirhan Sirhan, a 24-year-old Palestinian, fired a .22 caliber revolver at close range. Kennedy was struck three times, with one bullet lodging in his brain. He was rushed to Good Samaritan Hospital where he underwent surgery but died 26 hours later on June 6, 1968. His assassination came just 63 days after Martin Luther King Jr.\'s murder, deepening the nation\'s trauma. He was buried at Arlington National Cemetery near his brother John.</div>', 'RFK'],
        [-1200, 1],
        [-1155, 1],
        [-748, 1],
        [-682, 1],
        [-681, 1],
        [-582, 1],
        [-579, 1],
        [-554, 1],
        [-534, 1],
        [-514, 1],
        [-465, 1],
        [-461, 1],
        [-439, 1],
        [-423, 2],
        [-404, 1],
        [-354, 1],
        [-352, 1],
        [-336, 1],
        [-314, 1],
        [-281, 1],
        [-252, 1],
        [-246, 1],
        [-238, 1],
        [-223, 1],
        [-192, 1],
        [-185, 1],
        [-176, 1],
        [-146, 1],
        [-139, 1],
        [-138, 1],
        [-135, 1],
        [-133, 1],
        [-117, 1],
        [-91, 1],
        [-48, 1],
        [-44, 1],
        [-43, 1],
        [192, 2],
        [200, 1],
        [212, 1],
        [217, 1],
        [221, 1],
        [235, 1],
        [244, 1],
        [253, 2],
        [268, 3],
        [276, 1],
        [282, 1],
        [285, 2],
        [456, 1],
        [480, 1],
        [555, 1],
        [592, 1],
        [618, 1],
        [644, 1],
        [645, 1],
        [651, 1],
        [661, 1],
        [680, 1],
        [686, 1],
        [754, 1],
        [815, 1],
        [818, 1],
        [861, 1],
        [870, 1],
        [904, 1],
        [921, 1],
        [935, 1],
        [946, 1],
        [978, 1],
        [995, 1],
        [997, 1],
        [1052, 1],
        [1070, 1],
        [1079, 1],
        [1086, 1],
        [1092, 1],
        [1099, 1],
        [1100, 1],
        [1121, 1],
        [1127, 1],
        [1130, 1],
        [1134, 1],
        [1135, 1],
        [1136, 1],
        [1138, 1],
        [1146, 1],
        [1152, 1],
        [1168, 1],
        [1170, 1],
        [1174, 1],
        [1186, 1],
        [1189, 1],
        [1192, 1],
        [1196, 1],
        [1207, 1],
        [1208, 1],
        [1209, 1],
        [1213, 2],
        [1219, 1],
        [1225, 1],
        [1227, 1],
        [1233, 1],
        [1241, 1],
        [1260, 1],
        [1263, 1],
        [1264, 1],
        [1267, 1],
        [1270, 1],
        [1272, 1],
        [1282, 1],
        [1286, 1],
        [1290, 1],
        [1296, 3],
        [1306, 2],
        [1308, 1],
        [1311, 1],
        [1323, 1],
        [1345, 1],
        [1346, 1],
        [1354, 1],
        [1355, 1],
        [1358, 1],
        [1359, 1],
        [1369, 1],
        [1381, 3],
        [1383, 1],
        [1386, 2],
        [1389, 1],
        [1397, 1],
        [1407, 1],
        [1412, 1],
        [1415, 1],
        [1419, 1],
        [1425, 1],
        [1436, 1],
        [1437, 1],
        [1440, 1],
        [1441, 1],
        [1452, 1],
        [1456, 1],
        [1471, 1],
        [1478, 1],
        [1485, 1],
        [1486, 1],
        [1488, 1],
        [1497, 1],
        [1507, 1],
        [1520, 1],
        [1521, 1],
        [1528, 2],
        [1534, 1],
        [1535, 1],
        [1537, 1],
        [1541, 1],
        [1548, 1],
        [1550, 1],
        [1551, 2],
        [1557, 1],
        [1565, 1],
        [1566, 2],
        [1567, 1],
        [1570, 1],
        [1572, 1],
        [1578, 1],
        [1579, 1],
        [1582, 1],
        [1584, 1],
        [1589, 2],
        [1593, 1],
        [1596, 1],
        [1601, 1],
        [1602, 1],
        [1608, 1],
        [1610, 1],
        [1613, 1],
        [1617, 2],
        [1621, 2],
        [1622, 1],
        [1625, 2],
        [1628, 2],
        [1634, 1],
        [1639, 1],
        [1640, 2],
        [1649, 1],
        [1650, 1],
        [1651, 1],
        [1661, 2],
        [1663, 1],
        [1669, 1],
        [1672, 2],
        [1678, 1],
        [1679, 1],
        [1682, 2],
        [1695, 1],
        [1699, 1],
        [1703, 1],
        [1710, 1],
        [1716, 1],
        [1719, 1],
        [1744, 2],
        [1747, 1],
        [1762, 2],
        [1763, 1],
        [1782, 1],
        [1789, 1],
        [1792, 1],
        [1793, 1],
        [1800, 1],
        [1801, 1],
        [1804, 1],
        [1806, 2],
        [1810, 1],
        [1812, 2],
        [1815, 3],
        [1816, 1],
        [1817, 1],
        [1818, 2],
        [1819, 1],
        [1820, 1],
        [1823, 1],
        [1825, 2],
        [1826, 1],
        [1828, 1],
        [1829, 2],
        [1830, 3],
        [1831, 2],
        [1834, 1],
        [1835, 2],
        [1836, 1],
        [1837, 2],
        [1838, 2],
        [1839, 3],
        [1841, 2],
        [1842, 1],
        [1844, 2],
        [1845, 1],
        [1846, 2],
        [1847, 1],
        [1848, 1],
        [1849, 2],
        [1860, 3],
        [1861, 5],
        [1862, 2],
        [1863, 4],
        [1864, 1],
        [1866, 1],
        [1871, 1],
        [1872, 5],
        [1873, 3],
        [1875, 5],
        [1877, 3],
        [1878, 5],
        [1880, 1],
        [1881, 3, '<div class="radial2"><div><img src=img/shot.svg><span class="name">President James A. Garfield</span></div> - 20th President of the United States. On July 2, 1881, just four months into his presidency, Garfield was shot at the Baltimore and Potomac Railroad Station in Washington, D.C. by Charles J. Guiteau, a disgruntled office seeker who believed he deserved a political appointment. Guiteau shot Garfield twice in the back as the president waited for a train. One bullet grazed his arm, but the other lodged near his spine. Garfield survived the initial shooting but lingered for 79 days in excruciating pain. His condition was worsened by his doctors\' repeated probing of the wound with unsterilized instruments, causing infections. He died on September 19, 1881 at a seaside cottage in Elberon, New Jersey, where he had been moved to escape Washington\'s summer heat. The cause of death was blood poisoning and infection, largely due to unsanitary medical practices. Guiteau was convicted and hanged on June 30, 1882.</div>', 'James Garfield'],
        [1885, 2],
        [1886, 1],
        [1887, 1],
        [1889, 4],
        [1890, 2],
        [1892, 1],
        [1893, 2],
        [1894, 4],
        [1895, 2],
        [1896, 1],
        [1897, 4],
        [1898, 3],
        [1899, 2],
        [1900, 4],
        [1901, 1],
        [1902, 3],
        [1903, 5],
        [1904, 3],
        [1905, 14],
        [1906, 2],
        [1907, 3],
        [1908, 4],
        [1909, 3],
        [1910, 2],
        [1911, 3],
        [1912, 3],
        [1913, 11],
        [1915, 8],
        [1916, 5],
        [1917, 4],
        [1918, 12],
        [1919, 9],
        [1920, 8],
        [1921, 20],
        [1922, 11],
        [1923, 7],
        [1924, 13],
        [1925, 6],
        [1926, 2],
        [1927, 4],
        [1928, 9],
        [1929, 5],
        [1930, 5],
        [1931, 4],
        [1932, 11],
        [1933, 12],
        [1934, 10],
        [1935, 7],
        [1936, 12],
        [1937, 6],
        [1938, 10],
        [1939, 5],
        [1941, 6],
        [1942, 11],
        [1943, 12],
        [1944, 18],
        [1945, 14],
        [1946, 8],
        [1947, 16],
        [1949, 11],
        [1950, 7],
        [1951, 12],
        [1952, 5],
        [1953, 2],
        [1954, 5],
        [1955, 2],
        [1956, 1],
        [1957, 10],
        [1958, 11],
        [1959, 4],
        [1960, 6],
        [1961, 12],
        [1962, 6],
        [1963, 15],
        [1964, 3],
        [1966, 13],
        [1967, 9],
        [1969, 13],
        [1970, 32],
        [1971, 27],
        [1972, 26],
        [1973, 40],
        [1974, 29],
        [1975, 105],
        [1976, 84],
        [1977, 100],
        [1978, 149],
        [1979, 194],
        [1980, 210],
        [1981, 138],
        [1982, 155],
        [1983, 152],
        [1984, 179],
        [1985, 191],
        [1986, 165],
        [1987, 171],
        [1988, 230],
        [1989, 288],
        [1990, 240],
        [1991, 248, '<div class="radial2"><div><img src=img/bombed.svg><span class="name">Rajiv Gandhi</span></div> - Former Prime Minister of India (1984-1989) and son of assassinated Prime Minister Indira Gandhi. On May 21, 1991, while campaigning for the Congress Party in Tamil Nadu during India\'s general election, Gandhi was assassinated by a female suicide bomber named Thenmozhi Rajaratnam, a member of the Liberation Tigers of Tamil Eelam (LTTE). At 10:10 PM, as Gandhi approached supporters at a rally in Sriperumbudur, the bomber bent down as if to touch his feet (a traditional gesture of respect), then detonated an RDX explosive belt. The blast killed Gandhi instantly along with 14 others, including the bomber and several police officers. The assassination was orchestrated by LTTE leader Velupillai Prabhakaran in retaliation for Gandhi\'s decision to send Indian peacekeeping forces to Sri Lanka in 1987, which had opposed the Tamil Tigers. Gandhi\'s death shocked India and the world, as he was seen as a modernizing force and potential leader who could bridge India\'s future. His assassination effectively ended the Nehru-Gandhi political dynasty\'s direct leadership of India. The investigation led to the conviction of 26 conspirators, though the case remained politically sensitive for decades.</div>', 'Rajiv Gandhi'],
        [1992, 315],
        [1993, 55],
        [1994, 302],
        [1995, 234],
        [1996, 237],
        [1997, 161],
        [1998, 74],
        [1999, 96],
        [2000, 142],
        [2001, 147],
        [2002, 112],
        [2003, 98],
        [2004, 126],
        [2005, 166],
        [2006, 166],
        [2007, 150],
        [2008, 152],
        [2009, 166],
        [2010, 145],
        [2011, 158, '<div class="radial2"><div><img src=img/shot.svg><span class="name">Osama bin Laden</span></div> - Founder and leader of the terrorist organization Al-Qaeda, responsible for the September 11, 2001 attacks and numerous other terrorist operations worldwide. After nearly a decade-long manhunt following 9/11, bin Laden was located by U.S. intelligence at a compound in Abbottabad, Pakistan. On May 2, 2011, at approximately 1:00 AM local time, U.S. Navy SEAL Team Six launched "Operation Neptune Spear," a targeted raid on the compound. The SEALs breached the compound, engaged in firefights with bin Laden\'s bodyguards, and ultimately cornered bin Laden on the third floor of the main building. SEAL Team member Robert O\'Neill shot and killed bin Laden with multiple rounds to the chest and head. The operation lasted about 40 minutes. Bin Laden\'s body was identified through DNA testing and buried at sea within 24 hours according to Islamic tradition. President Barack Obama announced the successful mission to the world, declaring "justice has been done." The assassination marked a major victory in the War on Terror and brought symbolic closure to the 9/11 attacks, though Al-Qaeda continued operations under new leadership.</div>', 'Osama bin Laden'],
        [2012, 200],
        [2013, 171],
        [2014, 185],
        [2015, 215],
        [2016, 198],
        [2017, 170],
        [2018, 44],
        [2019, 57],
        [2020, 49],
        [2021, 41],
        [2022, 77],
        [2023, 40],
        [2024, 75],
        [2025, 38]
    ];

    var processedData = [];
    for (var i = 0; i < rawData.length; i++) {
        var year = rawData[i][0];
        var value = rawData[i][1];
        var detailsHTML = rawData[i][2];
        var annotation = rawData[i][3];
        var yearLabel = year < 0 ? Math.abs(year) + ' BCE' : year + ' CE';

        var barStyle = detailsHTML ? 'fill-color: #B85858; stroke-color: #B85858; stroke-width: 1' : 'fill-color: #cccccc; stroke-color: #cccccc; stroke-width: 1';

        var tooltipHTML = '<div class="tooltip-container">' +
            '<div class="tooltip-header">' +
            '<b>' + yearLabel + '</b><br>' +
            'Assassinations: ' + value +
            '</div>';

        if (detailsHTML) {
            tooltipHTML += '<hr class="tooltip-divider">' +
                '<div class="tooltip-details">' +
                detailsHTML +
                '</div>';
        }

        tooltipHTML += '</div>';

        processedData.push([year, value, barStyle, tooltipHTML]);
    }

    dataTable.addRows(processedData);
    chart = new google.visualization.ColumnChart(document.getElementById('chart_div'));

    google.visualization.events.addListener(chart, 'ready', function () {
        setButtonsEnabled(true);
    });

    setButtonsEnabled(false);
    drawChartWithView();
}

function adjustVAxisToData() {
    if (!dataTable) return;
    var rows = dataTable.getNumberOfRows();
    var xMin = options.hAxis.viewWindow.min;
    var xMax = options.hAxis.viewWindow.max;
    var maxVal = -Infinity;

    for (var r = 0; r < rows; r++) {
        var x = dataTable.getValue(r, 0);
        if (typeof x === 'number' && x >= xMin && x <= xMax) {
            var v = dataTable.getValue(r, 1);
            if (typeof v === 'number' && !isNaN(v) && v > maxVal) {
                maxVal = v;
            }
        }
    }

    if (!isFinite(maxVal) || maxVal <= 0) {
        maxVal = 10;
    }

    var roundedMax = maxVal > 100 ? Math.ceil((maxVal + 1) / 50) * 50 : Math.ceil((maxVal + 1) / 10) * 10;
    roundedMax = Math.max(10, Math.min(roundedMax, 350));

    options.vAxis.viewWindow = { min: 0, max: roundedMax };
}

function generateFormattedTicks() {
    var xMin = options.hAxis.viewWindow.min;
    var xMax = options.hAxis.viewWindow.max;
    var range = xMax - xMin;
    var ticks = [];

    var interval = 50;

    if (range > 500) {
        interval = 250;
    } else if (range > 2000) {
        interval = 100;
    } else if (range <= 50) {
        interval = 10;
    } else if (range <= 100) {
        interval = 25;
    }

    var start = Math.floor(xMin / interval) * interval;
    for (var year = start; year <= xMax; year += interval) {
        var label;
        if (year < 0) {
            label = Math.abs(year) + ' BCE';
        } else if (year === 0) {
            label = '0';
        } else {
            label = year + ' CE';
        }
        ticks.push({ v: year, f: label });
    }

    return ticks;
}

function redraw() {
    if (chart && dataTable) {
        setButtonsEnabled(false);
        drawChartWithView();
    } else {
        drawChart();
    }
}

var resizeTimeout;
window.addEventListener('resize', function () {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(function () {
        redraw();
    }, 250);
});

function setRangeIndex(idx) {
    currentIndex = idx;
    var r = ranges[idx];
    options.hAxis.viewWindow.min = r.min;
    options.hAxis.viewWindow.max = r.max;
    navButtons.forEach(function (b, i) {
        b.classList.toggle('active', i === idx);
    });

    var titles = document.querySelectorAll('.range-title');
    titles.forEach(function (title) {
        var rangeData = title.getAttribute('data-range');
        var rangeNums = rangeData.split(',').map(function (num) { return parseInt(num.trim()); });
        title.classList.toggle('active', rangeNums.indexOf(idx) !== -1);
    });
}
